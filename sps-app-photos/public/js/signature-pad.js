// Minimal signature capture — no external deps.
// Exposes window.SignaturePad(canvas)
(function () {
  function SignaturePad(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1c2321';

    let drawing = false;
    let hasInk = false;
    let last = null;

    function pos(evt) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const point = evt.touches ? evt.touches[0] : evt;
      return {
        x: (point.clientX - rect.left) * scaleX,
        y: (point.clientY - rect.top) * scaleY
      };
    }

    function start(evt) {
      evt.preventDefault();
      drawing = true;
      last = pos(evt);
    }
    function move(evt) {
      if (!drawing) return;
      evt.preventDefault();
      const p = pos(evt);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
      hasInk = true;
    }
    function end() {
      drawing = false;
      last = null;
    }

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    return {
      clear() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasInk = false;
      },
      isEmpty() {
        return !hasInk;
      },
      toDataURL() {
        return canvas.toDataURL('image/png');
      }
    };
  }

  window.SignaturePad = SignaturePad;
})();
