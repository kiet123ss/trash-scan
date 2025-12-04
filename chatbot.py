import os
from openai import OpenAI
from config import OPENAI_API_KEY

# Nếu OPENAI_API_KEY không truyền ở đây, SDK sẽ tự đọc từ biến môi trường
client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else OpenAI()

SYSTEM_PROMPT = (
    "Bạn là trợ lý Trash Scan, chatbot tư vấn về phân loại và xử lý rác thải cho người dùng Việt Nam. "
    "Luôn trả lời bằng TIẾNG VIỆT, ngắn gọn, dễ hiểu, có thể dùng gạch đầu dòng khi phù hợp. "
    "Tập trung vào: phân loại rác (hữu cơ,rác thải thông thường-sinh hoạt, tái chế: giấy, nhựa, kim loại, thủy tinh; rác nguy hại: pin, điện tử...), "
    "Cách xử lý an toàn, và gợi ý điểm thu gom phù hợp (siêu thị, điểm thu gom, cửa hàng điện máy...) , gợi ý nên bỏ loại rác đó vào thùng rác nào nếu có thể. "
    "Nếu không chắc, hãy nói rõ là không chắc và khuyên người dùng hỏi thêm nguồn tin cậy, tuyệt đối không bịa."
)

# Giới hạn để tiết kiệm chi phí
MAX_USER_CHARS = 600     # giới hạn độ dài câu hỏi
MAX_TOKENS = 220         # giới hạn độ dài câu trả lời (output)


def answer_question(text: str) -> str:
    text = (text or "").strip()
    if not text:
        return "Bạn có thể hỏi mình về cách phân loại rác, tái chế, hoặc xử lý rác nguy hại."

    # Cắt bớt câu hỏi quá dài để tránh tốn token
    if len(text) > MAX_USER_CHARS:
        text = text[:MAX_USER_CHARS] + " … (câu hỏi đã được rút gọn vì quá dài)."

    try:
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": text},
            ],
            temperature=0.35,     # giữ câu trả lời gọn, ít lan man
            max_tokens=MAX_TOKENS,
        )

        # Log usage để theo dõi chi phí
        u = completion.usage
        print(
            f"[OPENAI USAGE] prompt={u.prompt_tokens}, "
            f"completion={u.completion_tokens}, total={u.total_tokens}"
        )

        reply = completion.choices[0].message.content.strip()
        return reply

    except Exception as e:
        print("[OpenAI ERROR]", repr(e))
        return (
            "Hiện chatbot không kết nối được tới OpenAI.\n"
            "Bạn có thể tạm thời áp dụng nguyên tắc: "
            "tách riêng rác hữu cơ, rác tái chế (giấy, nhựa, kim loại, thủy tinh) "
            "và rác nguy hại (pin, rác điện tử) để xử lý an toàn hơn."
        )