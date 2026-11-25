// Photos picked in the browser are shrunk before they're stored or sent: at most 1024px on the
// long side, saved as a JPEG data URL. Used by the chat composer and the admin "Add found item"
// form. (With a backend, the original file would be uploaded instead.)

const Photos = {
  shrink(file, maxSize = 1024) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Couldn't process that image.");
          context.fillStyle = "#ffffff"; // transparent PNGs would turn black as JPEG
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(img, 0, 0, canvas.width, canvas.height);
          const photo = canvas.toDataURL("image/jpeg", 0.8);
          if (!photo.startsWith("data:image/jpeg;")) throw new Error("Couldn't encode that image.");
          resolve(photo);
        } catch (error) {
          reject(error);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Couldn't read that image."));
      };
      img.src = url;
    });
  },
};
