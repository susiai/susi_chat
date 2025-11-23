/**
 * Virtual File System (VFS) using IndexedDB with Bash-like Commands
 *
 * This script implements a simple key-value store using IndexedDB, which is a low-level API
 * for client-side storage of significant amounts of structured data, including files/blobs.
 * This API uses indexes to enable high-performance searches of this data.
 *
 * The VFS provides a set of methods for storing, retrieving, and deleting key-value pairs in an
 * IndexedDB object store, where keys represent paths in a file system-like structure.
 * Paths are delimited by a slash (/) and must start with a leading slash.
 * Paths ending with a slash are considered directories, while paths not ending with a slash are considered files.
 *
 * The VFS includes Bash-like commands for manipulating the virtual file system.
 *
 * The VFS is exposed as a global object (window.vfs) for easy access from other parts of the application.
 */

// Open a connection to the database
const openRequest = indexedDB.open('vfs', 1);

let vfsReadyResolve;
let vfsReadyReject;
window.vfsReady = new Promise((resolve, reject) => {
  vfsReadyResolve = resolve;
  vfsReadyReject = reject;
});

let db;

// Handle the database upgrade event
openRequest.onupgradeneeded = function (event) {
  const db = event.target.result;
  // Check if the object store exists before creating it
  if (!db.objectStoreNames.contains('keyValueStore')) {
    db.createObjectStore('keyValueStore', { keyPath: 'id' });
  }
};

// Handle the successful opening of the database
openRequest.onsuccess = function (event) {
  db = event.target.result;

  // Define the vfs object with methods to interact with the database
  const vfs = {
    put: function (key, value) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['keyValueStore'], 'readwrite');
        const store = transaction.objectStore('keyValueStore');
        const putRequest = store.put({ id: key, value });

        // Handle the successful storage of a key-value pair
        putRequest.onsuccess = function (event) {
          console.log('Key-value pair stored successfully.');
          resolve();
        };
        // Handle errors
        putRequest.onerror = function (event) {
          console.error('Error storing key-value pair:', event.target.errorCode);
          reject(event.target.errorCode);
        };
      });
    },
    getasync: function (key) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['keyValueStore'], 'readonly');
        const store = transaction.objectStore('keyValueStore');
        const getRequest = store.get(key);
        getRequest.onsuccess = function (event) {
          // Check if the key exists before resolving the promise
          if (event.target.result) {
            resolve(event.target.result.value);
          } else {
            reject('Key not found');
          }
        };
        getRequest.onerror = function (event) {
          reject(event.target.errorCode);
        };
      });
    },
    get: async function (key) {
      return await this.getasync(key);
    },
    rm: function (key) {
      const transaction = db.transaction(['keyValueStore'], 'readwrite');
      const store = transaction.objectStore('keyValueStore');
      const deleteRequest = store.delete(key);
      deleteRequest.onsuccess = function (event) {
        console.log('Entry removed successfully.');
      };
      deleteRequest.onerror = function (event) {
        console.error('Error removing entry:', event.target.errorCode);
      };
    },

    // the following methods all consider that keys are paths and have their proper shape:
    // - a path must have a leading slash
    // - a path ending with a slash is considered a directory
    // - a path not ending with a slash is considered a file
    // - directories cannot be created or removed directly,
    // - creating a file creates also the parent directory, removing all files removes the directory.
    touch: function (path) {
      // Create a file at the specified path.
      if (!path.startsWith('/') || path === '') {
        throw new Error('Invalid path');
      }
      const dirPath = path.substring(0, path.lastIndexOf('/')) + '/';
      const fileName = path.substring(path.lastIndexOf('/') + 1);
      const transaction = db.transaction(['keyValueStore'], 'readwrite');
      const store = transaction.objectStore('keyValueStore');
      const putRequest = store.put({ id: path, value: '' });
      putRequest.onsuccess = function (event) {
        console.log(`File created at ${path}`);
      };
      putRequest.onerror = function (event) {
        console.error(`Error creating file at ${path}: ${event.target.errorCode}`);
      };
    },
    rm: function (path) {
      // Remove a file or directory at the specified path.
      if (!path.startsWith('/') || path === '') {
        throw new Error('Invalid path');
      }
      const transaction = db.transaction(['keyValueStore'], 'readwrite');
      const store = transaction.objectStore('keyValueStore');
      const deleteRequest = store.delete(path);
      deleteRequest.onsuccess = function (event) {
        console.log(`Entry removed at ${path}`);
      };
      deleteRequest.onerror = function (event) {
        console.error(`Error removing entry at ${path}: ${event.target.errorCode}`);
      };
    },
    cp: function (srcPath, destPath) {
      // Copy a file or directory from one path to another.
      if (!srcPath.startsWith('/') || !destPath.startsWith('/') || srcPath === '' || destPath === '') {
        throw new Error('Invalid path');
      }
      const transaction = db.transaction(['keyValueStore'], 'readwrite');
      const store = transaction.objectStore('keyValueStore');
      const getRequest = store.get(srcPath);
      getRequest.onsuccess = function (event) {
        const value = event.target.result ? event.target.result.value : {};
        const putRequest = store.put({ id: destPath, value });
        putRequest.onsuccess = function (event) {
          console.log(`Entry copied from ${srcPath} to ${destPath}`);
        };
        putRequest.onerror = function (event) {
          console.error(`Error copying entry from ${srcPath} to ${destPath}: ${event.target.errorCode}`);
        };
      };
      getRequest.onerror = function (event) {
        console.error(`Error getting entry at ${srcPath}: ${event.target.errorCode}`);
      };
    },
    mv: function (srcPath, destPath) {
      // Move or rename a file or directory from one path to another.
      if (!srcPath.startsWith('/') || !destPath.startsWith('/') || srcPath === '' || destPath === '') {
        throw new Error('Invalid path');
      }
      const transaction = db.transaction(['keyValueStore'], 'readwrite');
      const store = transaction.objectStore('keyValueStore');
      const getRequest = store.get(srcPath);
      getRequest.onsuccess = function (event) {
        const value = event.target.result ? event.target.result.value : {};
        const deleteRequest = store.delete(srcPath);
        deleteRequest.onsuccess = function (event) {
          const putRequest = store.put({ id: destPath, value });
          putRequest.onsuccess = function (event) {
            console.log(`Entry moved from ${srcPath} to ${destPath}`);
          };
          putRequest.onerror = function (event) {
            console.error(`Error moving entry from ${srcPath} to ${destPath}: ${event.target.errorCode}`);
          };
        };
        deleteRequest.onerror = function (event) {
          console.error(`Error deleting entry at ${srcPath}: ${event.target.errorCode}`);
        };
      };
      getRequest.onerror = function (event) {
        console.error(`Error getting entry at ${srcPath}: ${event.target.errorCode}`);
      };
    },
    ls: function (path) {
      // List the contents of a directory at the specified path.
      if (!path.endsWith('/')) {
        throw new Error('Invalid directory path');
      }
      const transaction = db.transaction(['keyValueStore'], 'readonly');
      const store = transaction.objectStore('keyValueStore');
      const cursorRange = path === '/' ? IDBKeyRange.lowerBound(path) : IDBKeyRange.bound(path, path.substring(0, path.length - 1) + '\uffff', false, true);
    
      return new Promise((resolve, reject) => {
        const cursorRequest = store.openCursor(cursorRange);
        const contents = [];
        cursorRequest.onsuccess = function (event) {
          const cursor = event.target.result;
          if (cursor) {
            if (cursor.key.startsWith(path)) {
              contents.push(cursor.key.substring(path.length));
            }
            cursor.continue();
          } else {
            resolve(contents);
          }
        };
        cursorRequest.onerror = function (event) {
          reject(`Error listing directory at ${path}: ${event.target.errorCode}`);
        };
      });
    },    
    cat: function (path) {
      // Display the contents of a file at the specified path.
      if (path.endsWith('/')) {
        throw new Error('Invalid file path');
      }
      const transaction = db.transaction(['keyValueStore'], 'readonly');
      const store = transaction.objectStore('keyValueStore');
      const getRequest = store.get(path);
      getRequest.onsuccess = function (event) {
        console.log(event.target.result ? event.target.result.value : '');
      };
      getRequest.onerror = function (event) {
        console.error(`Error getting file at ${path}: ${event.target.errorCode}`);
      };
    },
    find: function (pattern) {
      // Search for files or directories matching a specified pattern.
      const transaction = db.transaction(['keyValueStore'], 'readonly');
      const store = transaction.objectStore('keyValueStore');
      const cursorRequest = store.openCursor();
      const matches = [];
      cursorRequest.onsuccess = function (event) {
        const cursor = event.target.result;
        if (cursor) {
          if (new RegExp(pattern).test(cursor.key)) {
            matches.push(cursor.key);
          }
          cursor.continue();
        } else {
          console.log(matches.join('\n'));
        }
      };
      cursorRequest.onerror = function (event) {
        console.error(`Error finding pattern ${pattern}: ${event.target.errorCode}`);
      };
    },

    du: function () {
      // Show the disk usage of files and directories.
      const transaction = db.transaction(['keyValueStore'], 'readonly');
      const store = transaction.objectStore('keyValueStore');
      let totalSize = 0;

      return new Promise((resolve, reject) => {
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = function (event) {
          const cursor = event.target.result;
          if (cursor) {
            const keyLength = cursor.key ? cursor.key.length : 0;
            const valueLength = cursor.value ? cursor.value.length : 0;
            if (!isNaN(keyLength) && !isNaN(valueLength)) {
              totalSize += keyLength + valueLength;
            }
            cursor.continue();
          } else {
            resolve(totalSize);
          }
        };
        cursorRequest.onerror = function (event) {
          reject(`Error getting disk usage: ${event.target.errorCode}`);
        };
      });
    },
    df: function () {
      // Show the amount of disk space used and available on the file system.
      // Note: This is a virtual file system, so the available space is not limited by actual storage.
      // However, for demonstration purposes, we'll set a limit of 50MB.
      const maxSize = 50 * 1024 * 1024;
      const transaction = db.transaction(['keyValueStore'], 'readonly');
      const store = transaction.objectStore('keyValueStore');
      let totalSize = 0;

      return new Promise((resolve, reject) => {
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = function (event) {
          const cursor = event.target.result;
          if (cursor) {
            const keyLength = cursor.key ? cursor.key.length : 0;
            const valueLength = cursor.value ? cursor.value.length : 0;
            if (!isNaN(keyLength) && !isNaN(valueLength)) {
              totalSize += keyLength + valueLength;
            }
            cursor.continue();
          } else {
            resolve(maxSize - totalSize);
          }
        };
        cursorRequest.onerror = function (event) {
          reject(`Error getting disk space: ${event.target.errorCode}`);
        };
      });
    },
    grep: function (path, pattern) {
      // Search for a pattern in file content at the specified path.
      if (!path.startsWith('/') || path === '') {
        throw new Error('Invalid path');
      }
      const transaction = db.transaction(['keyValueStore'], 'readonly');
      const store = transaction.objectStore('keyValueStore');
      const getRequest = store.get(path);
      getRequest.onsuccess = function (event) {
        const content = event.target.result ? event.target.result.value : '';
        if (new RegExp(pattern).test(content)) {
          console.log(`${path}: ${content}`);
        }
      };
      getRequest.onerror = function (event) {
        console.error(`Error getting file at ${path}: ${event.target.errorCode}`);
      };
    }
  };

  // Attach the vfs object to the window object
  window.vfs = vfs;
  if (vfsReadyResolve) vfsReadyResolve(vfs);
};

// Handle errors when opening the database
openRequest.onerror = function (event) {
  console.error('Error opening database:', event.target.errorCode);
  if (vfsReadyReject) vfsReadyReject(event.target.errorCode);
};
