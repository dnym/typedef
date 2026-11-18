// Turns beforeinput and composition events on a hidden field into
// "typed character at time t" events.
//
// The character the browser delivers is what counts, so any OS layout,
// firmware layer or remap works. Dead keys (´ ` ^ ~ ¨ on Swedish layouts)
// arrive as a composition; the composed result is one character with one
// timing, taken when the composition ends.

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'Dead', 'Compose', 'Process', 'Unidentified', 'Hyper', 'Super', 'Fn']);

// onChar({ ch, t, code }), onCommand(name) for 'skip' (Escape).
export function attachInput(el, { onChar, onCommand = () => {} }) {
  let lastCode = null;
  let compCode = null;
  let composing = false;

  const emit = (text, t, code) => {
    for (const ch of text.normalize('NFC')) onChar({ ch: ch === '\r' ? '\n' : ch, t, code });
  };
  const clear = () => {
    if (!composing) el.value = '';
  };

  el.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onCommand('skip');
      return;
    }
    if (e.key === 'Tab') e.preventDefault();
    if (e.key === 'Backspace' || e.key === 'Delete') e.preventDefault();
    if (!MODIFIERS.has(e.key)) lastCode = e.code;
    else if (e.key === 'Dead') lastCode = e.code;
  });

  el.addEventListener('beforeinput', (e) => {
    if (e.isComposing || composing) return;
    switch (e.inputType) {
      case 'insertText':
        e.preventDefault();
        if (e.data) emit(e.data, e.timeStamp, lastCode);
        break;
      case 'insertLineBreak':
      case 'insertParagraph':
        e.preventDefault();
        emit('\n', e.timeStamp, lastCode || 'Enter');
        break;
      case 'insertCompositionText':
      case 'insertFromComposition':
      case 'deleteCompositionText':
        break;
      default:
        // No backspacing, pasting or dropping.
        e.preventDefault();
    }
  });

  el.addEventListener('compositionstart', () => {
    composing = true;
    compCode = lastCode;
  });
  el.addEventListener('compositionend', (e) => {
    composing = false;
    if (e.data) emit(e.data, e.timeStamp, compCode);
    compCode = null;
    // Let the browser finish its own update before emptying the field.
    setTimeout(clear, 0);
  });
  el.addEventListener('input', () => {
    if (!composing) el.value = '';
  });
}
