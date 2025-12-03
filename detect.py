from ultralytics import YOLO
from pathlib import Path
import numpy as np

from config import BASE_DIR

# Đường dẫn tới model YOLO (best.pt)
MODEL_PATH = BASE_DIR / "best.pt"  # Đặt file best.pt cạnh app.py / detect.py

class RecycleDetector:
    def __init__(self):
        print(f"[YOLO] Loading model from {MODEL_PATH} ...")
        self.model = YOLO(str(MODEL_PATH))
        print("[YOLO] Model loaded.")
        print(f"[YOLO] Model classes: {self.model.names}")

        # Map nhãn -> thông tin tái chế
        self.recycle_map = {
            "giay bao - bia cung": {
                "recyclable": True,
                "Loại thùng rác": "🗑️ **THÙNG TRẮNG** (rác tái chế – giấy, carton)",
                "tip": "Giấy/carton nên để khô, không dính dầu mỡ trước khi đem đi tái chế.",
                "gmaps_keyword": "paper recycling"
            },
            "chai nhua - nap chai nhua": {
                "recyclable": True,
                "Loại thùng rác": "🗑️ **Thùng trắng** (Lưu ý: nắp chai nhựa KHÔNG tái chế được ở VN)",
                "tip": "Chai nhựa PET nên súc sạch, tháo nắp, ép dẹt trước khi bán/đem đi thu gom.",
                "gmaps_keyword": "Tái chế nhựa"
            },
            "kim loai": {
                "recyclable": True,
                "Loại thùng rác":"🗑️ **THÙNG TRẮNG** (rác tái chế – kim loại)",
                "tip": "Lon, sắt, nhôm thường bán đồng nát hoặc điểm thu gom ve chai.Nên rửa sạch, đập dẹp nếu có thể.",
                "gmaps_keyword": "Kim loại thu gom"
            },
            "thuy tinh": {
                "recyclable": True,
                "tip": "Thủy tinh nên tách riêng, cẩn thận vỡ, không lẫn với rác sinh hoạt.",
                "Loại thùng rác":"🗑️ **THÙNG TRẮNG** (rác tái chế – thủy tinh)",
                "gmaps_keyword": "Tái chế thủy tinh"
            },
            "chat thai huu co": {
                "recyclable": False,
                "tip": "Rác hữu cơ có thể ủ làm phân compost tại nhà.Nên loại bỏ túi nilon, vật liệu không phân hủy trước khi đem ủ.",
                "Loại thùng rác":"🗑️ **THÙNG ĐỎ** (rác hữu cơ phân hủy sinh học)",
                "gmaps_keyword": None
            },
            "chat thai nguy hai": {
                "recyclable": True,
                "Loại thùng rác" :"🗑️ **THÙNG VÀNG** (rác thải nguy hại – pin, bóng đèn, điện tử)",
                "tip": "Pin, rác điện tử,...không vứt bừa, phải đem tới đơn vị thu gom chuyên biệt, KHÔNG bỏ chung rác sinh hoạt.",
                "gmaps_keyword": "Tái chế chất thải nguy hại"
            },
            "nhua HDPE": {
                "recyclable": True,
                "Loại thùng rác": "🗑️ **THÙNG TRẮNG** (rác tái chế – nhựa cứng)",
                "tip": "Rửa sạch, bóp dẹp (chai dầu gội, xô nhựa, can nước lớn).",
                "gmaps_keyword": "Tái chế nhựa HDPE"
            },
            "chat thai thong thuong": {
                "recyclable": False,
                "xu_ly": "Gom gọn, không cần rửa (túi nilon, giấy bạc dơ, ống hút, hộp xốp).",
                "Loại thùng rác:": "🗑️ **THÙNG XANh LÁ** (rác thông thường – đốt/chôn lấp)",
                "tip": "Giảm dùng túi nilon → mang túi vải để bảo vệ môi trường!.Nên phân loại kỹ trước khi bỏ vào.",
                "gmaps_keyword": None
            },
            "tui nylon": {
                "recyclable": False,
                "tip": "Túi nilon khó tái chế. Hạn chế sử dụng, thay bằng túi vải hoặc túi giấy.",
                "gmaps_keyword": None
            }
        }
        
        # Map tên class từ YOLO -> tên hiển thị tiếng Việt có dấu
        self.name_map = {
            "giay bao - bia cung": "Giấy báo – Bìa cứng",
            "chai nhua - nap chai nhua": "Chai nhựa – Nắp chai nhựa",
            "chat thai huu co": "Chất thải hữu cơ",
            "chat thai nguy hai": "Chất thải nguy hại",
            "chat thai thong thuong": "Chất thải thông thường",
            "kim loai": "Kim loại",
            "nhua HDPE": "Nhựa HDPE",
            "thuy tinh": "Thủy tinh",
            "tui nylon": "Túi nilon"
        }

    def _process_results(self, results):
        """Helper to process YOLO results into list of dicts."""
        detections = []
        for box in results.boxes:
            cls_id = int(box.cls[0])
            cls_name = results.names[cls_id]
            conf = float(box.conf[0])
            x1, y1, x2, y2 = map(float, box.xyxy[0])

            # Get tracking ID if available
            track_id = int(box.id[0]) if box.id is not None else None

            recycle_info = self.recycle_map.get(cls_name, {
                "recyclable": False,
                "tip": "Chưa có thông tin tái chế cho loại rác này.",
                "gmaps_keyword": None
            })
            
            # Translate class name to Vietnamese display name
            display_name = self.name_map.get(cls_name, cls_name)

            detections.append({
                "track_id": track_id,
                "class_id": cls_id,
                "class_name": cls_name,  # Keep original name for bounding box
                "display_name": display_name,  # Vietnamese name for results display
                "confidence": conf,
                "bbox": [x1, y1, x2, y2],
                "recyclable": recycle_info["recyclable"],
                "tip": recycle_info["tip"],
                "gmaps_keyword": recycle_info["gmaps_keyword"]
            })
        return detections

    def detect_image(self, img_bgr: np.ndarray):
        """Nhận ảnh BGR (numpy) -> list detection (Single image)."""
        results = self.model.predict(img_bgr, imgsz=640, conf=0.15, verbose=False)[0]
        detections = self._process_results(results)
        print(f"[YOLO] Detected {len(detections)} objects with conf >= 0.15")
        if len(detections) > 0:
            for d in detections:
                print(f"  - {d['display_name']}: {d['confidence']:.2f}")
        return detections

    def track_image(self, img_bgr: np.ndarray):
        """Nhận ảnh BGR (numpy) -> list detection (Tracking stream)."""
        # Sử dụng tracker="bytetrack.yaml" và persist=True để tracking
        results = self.model.track(img_bgr, imgsz=640, conf=0.5, tracker="bytetrack.yaml", persist=True, verbose=False)[0]
        return self._process_results(results)
