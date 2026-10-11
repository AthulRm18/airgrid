// Reduce upload latency and Gemini image-processing cost while retaining detail.
export async function preparePhoto(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error("Choose a photo smaller than 10 MB.");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Choose a readable JPEG, PNG, or WebP photo.");
  }
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) throw new Error("Could not prepare the photo. Please choose another image.");
    return new File([blob], "report-photo.jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
