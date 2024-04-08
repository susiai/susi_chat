#!/bin/zsh
cd "`dirname $0`"
#../../llama.cpp/server -t 16 -c 65543 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/Karasu-Mixtral-8x22B-v0.1-Q2_K.gguf #fail, garbage out
#../../llama.cpp/server -t 16 -c 65543 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/froggeric-WhiteRabbitNeo-33B-v1.5-Q8_0.gguf #fail, garbage out
#../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/mixtral-8x7b-instruct-v0.1.Q6_K.gguf #ok
#../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/WhiteRabbitNeo-33B-v1.5_Q8_0.gguf # fail, garbage out
#../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/WhiteRabbitNeo-33B-v1.5-Q4_K_M.gguf # fail, does not start
#../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/dolphin-2.7-mixtral-8x7b.Q4_K_M.gguf #ok
#../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/wizardcoder-33b-v1.1.Q4_K_M.gguf #ok
#../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/deepseek-coder-33b-instruct.Q4_K_M.gguf
#../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/OpenCodeInterpreter-DS-33B-Q4_K_M.gguf #ok
#../../llama.cpp/server -t 16 -c 65543 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/gemma-7b-it.Q8_0.gguf #ok
#../../llama.cpp/server -t 16 -c 65543 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/codegemma-7b-Q8_0.gguf #ok
#../../llama.cpp/server -t 16 -c 65543 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/dolphin-2.8-experiment26-7b-Q8_0.gguf #ok
#../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/Starling-LM-7B-beta-Q8_0.gguf #ok
#../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/dolphin-2.8-mistral-7b-v02-Q8_0.gguf #ok
#../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/openchat-3.5-0106.Q8_0.gguf #ok
#../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/Experiment26-7B.Q8_0.gguf #ok
#../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/opencodeinterpreter-ds-6.7b.Q8_0.gguf #ok
#../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/WhiteRabbitNeo-7B-v1.5a-Q8_0.gguf #ok
#../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/WhiteRabbitNeo-7B-v1.5a-Q4_K_M.gguf #ok
#../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/deepseek-coder-6.7b-instruct.Q8_0.gguf #ok
#../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/magicoder-s-ds-6.7b.Q8_0.gguf #fail, creates incomplete chunk encoding
../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/WhiteRabbitNeo-7B-v1.5a-Q4_K_M.gguf
#../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/gemma-2b-it.Q8_0.gguf #ok
#../../llama.cpp/server -t 16 -c 32768 -np 4 --host 0.0.0.0 --port 8004 --log-disable --path ../chat_terminal/ -m ../../llama.cpp/models/codegemma-2b-Q8_0.gguf
