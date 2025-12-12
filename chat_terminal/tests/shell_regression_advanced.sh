#!/bin/sh
# Advanced shell regression tests for the browser VFS shell.

pass=0
fail=0
case_num=1

rm -rf adv_tmp 2>/dev/null
mkdir -p adv_tmp

name="pipeline with output redirection"
expected="2"
echo a | wc -c > adv_tmp/out.txt
actual=$(cat adv_tmp/out.txt | tr -d ' ')
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="and/or chains"
expected="ok ok"
actual=$(test 1 -eq 1 && echo ok; test 1 -eq 2 || echo ok)
actual=$(echo "$actual" | tr '\n' ' ' | tr -s ' ' | tr -d '\r' | sed 's/[[:space:]]*$//')
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="nested conditionals"
expected="ok"
actual=$(if test 1 -eq 1; then if test 2 -eq 2; then echo ok; fi; fi)
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="while loop with continue"
expected="1 3"
actual=$(i=0; while test $i -lt 3; do i=$((i+1)); if test $i -eq 2; then continue; fi; echo $i; done)
actual=$(echo "$actual" | tr '\n' ' ' | tr -s ' ' | tr -d '\r' | sed 's/[[:space:]]*$//')
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="command substitution nesting"
expected="hi"
actual=$(echo $(echo $(echo hi)))
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="backtick substitution"
expected="hi"
actual=$(echo `echo hi`)
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="stderr redirection"
expected="missing"
stdout=$(cat /nope 2> adv_tmp/err.txt)
actual=$(cat adv_tmp/err.txt)
if test -n "$stdout" || test -n "$actual"; then
  actual="missing"
else
  actual=""
fi
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="find -name glob"
expected="adv_tmp/a.txt adv_tmp/err.txt adv_tmp/out.txt"
printf "x\n" > adv_tmp/a.txt
actual=$(find adv_tmp -name "*.txt" | sort)
actual=$(echo "$actual" | tr -d '\r' | tr '\n' ' ' | tr -s ' ' | sed 's/[[:space:]]*$//')
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="sort -n -k"
expected="1 c"
printf "2 a\n10 b\n1 c\n" > adv_tmp/sort.txt
actual=$(sort -n -k 1 adv_tmp/sort.txt | head -n 1)
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="cut -b range"
expected="bc"
actual=$(printf "abcd" | cut -b 2-3)
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="sed substitution"
expected="xb"
actual=$(printf "ab" | sed "s/a/x/")
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

name="awk field print"
expected="2"
actual=$(printf "1 2\n" | awk '{print $2}')
if test "$actual" = "$expected"; then
  printf "ok %s - %s\n" "$case_num" "$name"
  pass=$((pass+1))
else
  printf "not ok %s - %s (expected: %s, got: %s)\n" "$case_num" "$name" "$expected" "$actual"
  fail=$((fail+1))
fi
case_num=$((case_num+1))

printf "\nPassed: %s, Failed: %s\n" "$pass" "$fail"
if test "$fail" = "0"; then
  exit 0
else
  exit 1
fi
