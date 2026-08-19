// auto-render.js はKaTeXのauto-render拡張を持ち込んだものなので、
// 本体には手を入れず宣言だけ添える。
// childNodesを再帰的に辿るだけなので、Element でも Document でも渡せる。
declare function renderMathInElement (elem: Element | Document, options?: any): void;
export default renderMathInElement;
