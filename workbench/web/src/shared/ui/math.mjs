import renderMathInElement from '../../../vendor/katex/auto-render.mjs';

/** Render text only; leave controls, source code and previously rendered math intact. */
export function renderMath(root) {
  if (!root) return;
  renderMathInElement(root, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false },
      { left: '$', right: '$', display: false },
    ],
    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option', 'select', 'input'],
    ignoredClasses: ['katex', 'katex-display', 'no-math'],
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    maxExpand: 200,
    maxSize: 20,
    output: 'htmlAndMathml',
    errorColor: '#b34949',
  });
}
