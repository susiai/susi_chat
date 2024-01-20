#!/bin/zsh
cd "`dirname $0`"
../../llama.cpp/server -t 20 -c 32768 -np 2 -ngl 99 --host 0.0.0.0 --port 8001 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/mixtral-8x7b-instruct-v0.1.Q6_K.gguf > /dev/null 2>&1
