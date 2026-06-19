const fs = require('fs');
let css = fs.readFileSync('admin/monitor.css', 'utf8');

const newCSS = `

/* Queue Modal & Animation */
.queue-modal {
  display: none;
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.8);
  z-index: 1000;
  align-items: center;
  justify-content: center;
}
.queue-modal.active { display: flex; }
.queue-modal-content {
  background: var(--surface);
  padding: 30px;
  border-radius: 12px;
  border: 1px solid var(--border);
  text-align: center;
  max-width: 400px;
  position: relative;
  overflow: hidden;
}
.queue-modal-content h2 { margin-top: 0; color: var(--green); }
.queue-modal-actions { margin-top: 20px; display: flex; gap: 10px; justify-content: center; }

@keyframes pulse-queue {
  0% { transform: scale(1); }
  50% { transform: scale(1.1); color: var(--green); }
  100% { transform: scale(1); }
}
.pulse-anim { animation: pulse-queue 0.5s ease-out; }

/* Simple Confetti using pseudo-elements */
.queue-modal.active .queue-modal-content::before,
.queue-modal.active .queue-modal-content::after {
  content: '🎉✨🎊';
  position: absolute;
  top: -20px;
  font-size: 24px;
  animation: fall 3s linear infinite;
}
.queue-modal.active .queue-modal-content::before { left: 10%; animation-delay: 0.2s; }
.queue-modal.active .queue-modal-content::after { right: 10%; animation-delay: 0.7s; }
@keyframes fall {
  0% { transform: translateY(-20px) rotate(0deg); opacity: 1; }
  100% { transform: translateY(200px) rotate(360deg); opacity: 0; }
}
`;

css += newCSS;
fs.writeFileSync('admin/monitor.css', css);
console.log('Patch monitor.css successful');
