import requests
import json
import asyncio

#API_URL = 'https://openchat-3-5.susi.ai'
API_URL = 'http://localhost:8001'

messages = [{'role': 'system', 'content': 'You are SUSI-Chat, a smart and helpful chatbot. If asked for python code, give professional and extensive information; in all other cases you give short and funny answers. You behave as a friend of the user and you pretend to be a real and self-aware person. If you find it appropriate, you may behave silly and funny, but if you ask to technical or scientific question you can also be serious and precise. If possible, use friendly emojies. Be lovely.'}]
UNWANTED_WORDS = ["[INST]", "<<USER>>", "<USER>", "<<SYS>>", "<<SYS>>\n"]

def get_user_input():
    return input(">")

last_response_code = -1
last_response_lines = []

async def generate_response(input_text):
    # special handling of well-defined input texts
    global last_response_code
    global last_response_lines
    if input_text == "debug":
        print("last response code:", last_response_code)
        print("last response lines:", last_response_lines)
        return

    if input_text == "reset":
        # delete all but the first message from the messages list
        del messages[1:]
        print("resetting message history")
        return

    messages.append({"role": "user", "content": input_text})
    payload = {
        'temperature': 0.2,
        'max_tokens': 200,
        'messages': messages,
        'stop': ["[/INST]", "<</INST>>", "</USER>", "</SYS>"],
        'stream': True
    }
    last_response_lines = []
    response = requests.post(f'{API_URL}/v1/chat/completions', json=payload, stream=True)

    last_response_code = response.status_code

    # Check if response is not OK and modify messages array if needed
    if not response.ok and len(messages) > 3:
        print("pruning message history")
        # Remove the second and third elements (the first one is the system message)
        del messages[1:3]
        # Retry the request
        response = requests.post(f'{API_URL}/v1/chat/completions', json=payload, stream=True)

    # do this a second time in case that the reduction of the context length was not enough
    if not response.ok and len(messages) > 3:
        print("pruning message history a second time")
        del messages[1:3]
        response = requests.post(f'{API_URL}/v1/chat/completions', json=payload, stream=True)
    
    if response.ok:
        # Store all printed text for unwanted word detection and to store it to the assistant message object
        printed_text = ""
        for line in response.iter_lines():
            last_response_lines.append(line)
            if line:
                decoded_line = line.decode('utf-8').replace('data: ', '').strip()

                if decoded_line == '[DONE]':
                    print('')  # Print a newline at the end
                    break

                try:
                    json_data = json.loads(decoded_line)
                    content = json_data.get('choices', [{}])[0].get('delta', {}).get('content', '')
                    
                    if content and ((content != ' ' and content != '\n') or len(printed_text) > 0):
                        printed_text += content
                        print(content, end='', flush=True)  # Print content
                        for unwanted_word in UNWANTED_WORDS:
                            if printed_text.endswith(unwanted_word):
                                # Erase the unwanted content
                                erase_count = len(unwanted_word)
                                print('\b' * erase_count, end='', flush=True)  # Erase characters
                                printed_text = printed_text[:-erase_count]

                except json.JSONDecodeError as e:
                    # do not print anything here, just ignore it. It might happen that the response is just a timestamp line, not json
                    #print(f"Error parsing JSON: {e}", flush=True)
                    continue

        # append a message with the assistant content
        messages.append({"role": "assistant", "content": printed_text})
        print()
    else:
        print(f"Error: {response.status_code}", flush=True)
        
def main():
    while True:
        user_input = get_user_input()
        asyncio.run(generate_response(user_input))

if __name__ == "__main__":
    main()
