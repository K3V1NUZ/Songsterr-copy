// Minimal, dependency-free XML parser (enough for MusicXML and Guitar Pro's GPIF).
// Works in the browser and in Node. Returns a tree of {name, attrs, children, text}.

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };
const decodeEntities = (s) => s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e] ?? m;
});

class Node {
  constructor(name, attrs) { this.name = name; this.attrs = attrs; this.children = []; this.text = ''; }
  child(name) { return this.children.find((c) => c.name === name) || null; }
  all(name) { return this.children.filter((c) => c.name === name); }
  // path like "Properties/Property"
  find(path) { let n = this; for (const p of path.split('/')) { n = n?.child(p); if (!n) return null; } return n; }
  t(name, def = '') { const c = name ? this.find(name) : this; return c ? c.text.trim() : def; }
  num(name, def = 0) { const v = parseFloat(this.t(name, '')); return isFinite(v) ? v : def; }
  has(name) { return !!this.child(name); }
  attr(k, def = null) { return this.attrs[k] ?? def; }
}

export function parseXML(src) {
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const root = new Node('#document', {});
  const stack = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) {
      const txt = src.slice(i, lt);
      if (txt.trim()) stack[stack.length - 1].text += decodeEntities(txt);
    }
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9);
      stack[stack.length - 1].text += src.slice(lt + 9, e < 0 ? n : e);
      i = e < 0 ? n : e + 3; continue;
    }
    if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt + 2); i = e < 0 ? n : e + 2; continue; }
    if (src.startsWith('<!', lt)) { // DOCTYPE, possibly with [internal subset]
      let depth = 0, j = lt + 2;
      for (; j < n; j++) { const c = src[j]; if (c === '[') depth++; else if (c === ']') depth--; else if (c === '>' && depth <= 0) break; }
      i = j + 1; continue;
    }
    if (src[lt + 1] === '/') {
      const e = src.indexOf('>', lt);
      const name = src.slice(lt + 2, e).trim().replace(/^.*:/, '');
      // pop to matching element (tolerant of mismatches)
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].name === name) { stack.length = k; break; }
      i = e + 1; continue;
    }
    // start tag: scan to '>' outside quotes
    let j = lt + 1, q = null;
    for (; j < n; j++) { const c = src[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break; }
    let body = src.slice(lt + 1, j);
    const selfClose = body.endsWith('/');
    if (selfClose) body = body.slice(0, -1);
    const m = /^([^\s/>]+)/.exec(body);
    const name = (m ? m[1] : '').replace(/^.*:/, '');
    const attrs = {};
    const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a;
    const rest = body.slice(m ? m[0].length : 0);
    while ((a = re.exec(rest))) attrs[a[1].replace(/^.*:/, '')] = decodeEntities(a[3] ?? a[4]);
    const node = new Node(name, attrs);
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
    i = j + 1;
  }
  return root.children.find((c) => c instanceof Node) || root;
}

export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}
