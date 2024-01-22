#!/bin/zsh
cd "`dirname $0`"
../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/mixtral-8x7b-instruct-v0.1.Q6_K.gguf
