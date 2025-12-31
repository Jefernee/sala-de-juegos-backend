/*import multer from "multer";

const storage = multer.memoryStorage();

const upload = multer({ storage });

export const uploadSingleImage = upload.single("imagen");*/

// middlewares/upload.js
import multer from "multer";

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

export default upload;




