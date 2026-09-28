// Range math is independent of Vue/DOM so viewport edges can be verified directly.
export function virtualListRange({ count, scrollOffset, viewportHeight, rowHeight, overscan = 4 }) {
  const totalHeight = count * rowHeight;
  const start = Math.min(count, Math.max(0, Math.floor(scrollOffset / rowHeight) - overscan));
  const end = Math.min(count, Math.max(start, Math.ceil((scrollOffset + viewportHeight) / rowHeight) + overscan));
  return { start, end, offset: start * rowHeight, totalHeight };
}
