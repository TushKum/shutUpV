"use client";

// Scrolls a list (the element with this id) so its current item ([aria-current]) is in view. Only the list scrolls,
// never the page.

import { useEffect } from "react";

export function ScrollToCurrent({ listId, current }: { listId: string; current: string | null }) {
  useEffect(() => {
    const list = document.getElementById(listId);
    const item = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !item) return;
    const l = list.getBoundingClientRect();
    const i = item.getBoundingClientRect();
    if (i.top < l.top || i.bottom > l.bottom) list.scrollTop += i.top - l.top - (l.height - i.height) / 2;
  }, [listId, current]);
  return null;
}
