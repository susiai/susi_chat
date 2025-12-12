#!/bin/sh
# Shell regression tests for the browser VFS shell.

pass=0
fail=0
case_num=1

rm -rf test_tmp 2>/dev/null
mkdir -p test_tmp

name="head reads first line"
expected="a"
printf "a\nb\n" > test_tmp/t.txt
actual=$(head -n 1 test_tmp/t.txt)
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="append with >> increases line count"
expected="3"
printf "c\n" >> test_tmp/t.txt
actual=$(wc -l < test_tmp/t.txt | tr -d ' ')
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="pipe to wc counts bytes"
expected="2"
actual=$(printf "hi" | wc -c | tr -d ' ')
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="cut -d -f extracts field"
expected="two"
printf "one,two,three" | cut -d , -f 2 > test_tmp/cut.txt
actual=$(cat test_tmp/cut.txt)
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="cut -b extracts bytes"
expected="bcd"
actual=$(printf "abcdef" | cut -b 2-4)
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="tr maps ranges"
expected="ABC"
actual=$(printf "abc" | tr a-z A-Z)
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="sort | uniq collapses duplicates"
expected="a b"
printf "b\na\nb\n" > test_tmp/u.txt
actual=$(sort test_tmp/u.txt | uniq)
actual=$(echo "$actual" | tr '\n' ' ' | tr -s ' ' | tr -d '\r' | sed 's/[[:space:]]*$//')
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="diff identical files returns success"
if diff test_tmp/t.txt test_tmp/t.txt > test_tmp/diff.txt; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: exit 0, got: exit 1)\n" "$case_num" "$name"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="diff different files returns failure"
printf "x\n" > test_tmp/d1.txt
printf "y\n" > test_tmp/d2.txt
if diff test_tmp/d1.txt test_tmp/d2.txt > test_tmp/diff.txt; then
  printf "not ok %s - %s (expected: exit 1, got: exit 0)\n" "$case_num" "$name"
  fail=$((fail+1))
else
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
fi
case_num=$((case_num+1))

name="find -name locates file"
expected="test_tmp/dir/sub/file.txt"
mkdir -p test_tmp/dir/sub
printf "z\n" > test_tmp/dir/sub/file.txt
actual=$(find test_tmp/dir -name file.txt | sed 's#^/##')
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="test numeric comparison works"
if test 3 -gt 2; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: exit 0, got: exit 1)\n" "$case_num" "$name"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="arithmetic expansion increments"
expected="2"
i=0
i=$((i+2))
actual="$i"
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="for loop iterates items"
expected="ab"
actual=$(for i in a b; do printf "%s" "$i"; done)
actual=$(echo "$actual" | tr -d ' \n\r')
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="if cmd; then uses exit status (success)"
if echo a | grep a > test_tmp/grep.txt; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: exit 0, got: exit 1)\n" "$case_num" "$name"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="if cmd; then uses exit status (failure)"
if echo a | grep z > test_tmp/grep.txt; then
  printf "not ok %s - %s (expected: exit 1, got: exit 0)\n" "$case_num" "$name"
  fail=$((fail+1))
else
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
fi
case_num=$((case_num+1))

printf "\nPassed: %s, Failed: %s\n" "$pass" "$fail"
if test "$fail" = "0"; then
  exit 0
else
  exit 1
fi
