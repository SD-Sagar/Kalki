import sys
import os
import glob
import json
import re
from threading import Thread
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKPACK_DIR = os.path.join(BASE_DIR, "..", "backend", "storage-backpack")

# We use the HuggingFace repo ID directly. Transformers will auto-download and cache it.
MODEL_ID = "Qwen/Qwen2.5-0.5B-Instruct"

def load_model():
    try:
        # Load tokenizer and model for CPU usage
        tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
        model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID, 
            torch_dtype=torch.float32, # float32 is safest for old CPUs
            low_cpu_mem_usage=True
        )
        return tokenizer, model
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        return None, None

def retrieve_context(query):
    if not os.path.exists(BACKPACK_DIR):
        return ""
    
    query_words = set(re.findall(r'\w+', query.lower()))
    txt_files = glob.glob(os.path.join(BACKPACK_DIR, "*", "*", "*.txt"))
    best_matches = []
    
    for file_path in txt_files:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                paragraphs = [p.strip() for p in content.split('\n\n') if p.strip()]
                for p in paragraphs:
                    p_words = set(re.findall(r'\w+', p.lower()))
                    match_score = len(query_words.intersection(p_words))
                    if match_score > 0:
                        best_matches.append((match_score, p))
        except Exception:
            continue
            
    best_matches.sort(key=lambda x: x[0], reverse=True)
    top_paragraphs = [m[1] for m in best_matches[:3]]
    return "\n".join(top_paragraphs)

def main():
    tokenizer, model = load_model()
    if not model or not tokenizer:
        print("INIT_ERROR")
        return
        
    print("INIT_SUCCESS")
    
    for line in sys.stdin:
        try:
            payload = json.loads(line.strip())
        except Exception:
            continue
            
        session_id = payload.get("sessionId", "")
        role = payload.get("role", "user")
        username = payload.get("username", "")
        query = payload.get("query", "")
        history = payload.get("history", [])
        generate_title = payload.get("generateTitle", False)

        if generate_title:
            sys_msg = "You are a title generator. Summarize the conversation into a very short 2-4 word title. Respond ONLY with the title."
            messages = [{"role": "system", "content": sys_msg}]
            for msg in history:
                r = "assistant" if msg["role"] == "kalki" else "user"
                messages.append({"role": r, "content": msg["content"]})
            # Include the current query as part of history if provided
            if query:
                messages.append({"role": "user", "content": query})
        else:
            context = retrieve_context(query)
            
            if role == 'admin':
                sys_msg = "You are Kalki, a highly advanced, 100% offline sovereign AI. You are talking directly to your creator, Sagar Dey. Acknowledge him respectfully. ALWAYS respond in English. Do not talk about your internal 'sub-chunks' or 'logic processing'. Answer factual questions ONLY using the provided Context Database. If the answer is not in the Database, say 'I do not have that information in my local database.'"
            else:
                user_greet = f"You are talking to a user named {username}." if username else ""
                sys_msg = f"You are Kalki, a highly advanced, 100% offline sovereign AI. {user_greet} ALWAYS respond in English. Do not talk about your internal 'sub-chunks' or 'logic processing'. Answer factual questions ONLY using the provided Context Database. If the answer is not in the Database, say 'I do not have that information in my local database.'"

            messages = [{"role": "system", "content": sys_msg}]
            
            for msg in history:
                r = "assistant" if msg["role"] == "kalki" else "user"
                messages.append({"role": r, "content": msg["content"]})
            
            messages.append({
                "role": "user", 
                "content": f"Context Database:\n{context if context else 'None'}\n\nUser Message: {query}"
            })

        text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = tokenizer([text], return_tensors="pt")
        
        streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
        kwargs = {"max_new_tokens": 10} if generate_title else {"max_new_tokens": 256}
        generation_kwargs = dict(inputs, streamer=streamer, temperature=0.7, repetition_penalty=1.1, do_sample=True, **kwargs)
        
        thread = Thread(target=model.generate, kwargs=generation_kwargs)
        thread.start()
        
        full_text = ""
        try:
            for new_text in streamer:
                full_text += new_text
                if not generate_title:
                    print(json.dumps({"event": "token", "sessionId": session_id, "token": new_text}), flush=True)
                
            if generate_title:
                print(json.dumps({"event": "title", "sessionId": session_id, "title": full_text.strip()}), flush=True)
            else:
                print(json.dumps({"event": "done", "sessionId": session_id, "full_text": full_text}), flush=True)
        except Exception as e:
            print(json.dumps({"event": "error", "sessionId": session_id, "error": str(e)}), flush=True)

if __name__ == "__main__":
    main()
