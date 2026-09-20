/** The live markup spells ring slots with two digits: item_01 .. item_24. */
export function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
