// These fixtures are created solely for this public test. No production files,
// performer information, third-party recordings or private source are used.
export function textPdf() {
  const body = "BT /F1 16 Tf 50 740 Td (ACTOR: Native PDF import works.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

export function waveAudio() {
  const sampleRate = 16000, samples = sampleRate * 2;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / sampleRate) * 1500), 44 + i * 2);
  return wav;
}

export async function syntheticVideo(page) {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 192; canvas.height = 108;
    const context = canvas.getContext("2d"), stream = canvas.captureStream(12), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 150000 });
    let frame = 0;
    const draw = () => {
      context.fillStyle = "#122239"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#72ddb8"; context.fillRect((frame++ * 8) % 160, 34, 32, 40);
    };
    draw();
    const timer = setInterval(draw, 80);
    try {
      const completed = new Promise((resolve, reject) => {
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = event => reject(new Error(event.error?.message || "Synthetic video recording failed"));
        recorder.onstop = resolve;
      });
      recorder.start(); await new Promise(resolve => setTimeout(resolve, 1600)); recorder.stop(); await completed;
      return Array.from(new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer()));
    } finally { clearInterval(timer); stream.getTracks().forEach(track => track.stop()); }
  });
  return Buffer.from(bytes);
}
