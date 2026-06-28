// NMEA0183 Logger — JSON parsing worker
// Off-loads JSON.parse for large stats responses to keep UI responsive.
// Main thread sends a string, worker returns the parsed object.

self.onmessage = function(e) {
  const { id, text } = e.data;
  try {
    const data = JSON.parse(text);
    self.postMessage({ id, data });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
