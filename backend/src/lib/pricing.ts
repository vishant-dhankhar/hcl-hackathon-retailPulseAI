export type Tier = 'STANDARD' | 'SILVER' | 'GOLD' | 'PLATINUM';
export function deliveryPaise(
  tier: Tier,
  subtotalPaise: number,
  fulfillment: string,
  express = false,
) {
  if (fulfillment === 'PICKUP' || tier === 'PLATINUM') return 0;
  if (express) return tier === 'GOLD' ? 9900 : 19900;
  return tier === 'GOLD' || (tier === 'SILVER' && subtotalPaise >= 199900) ? 0 : 9900;
}
export const toPaise = (value: { toString(): string } | string | number) =>
  Math.round(Number(value.toString()) * 100);
export const rupees = (paise: number) => (paise / 100).toFixed(2);
export function canTransition(from: string, to: string, fulfillment: string) {
  if (from === 'PLACED' && to === 'CANCELLED') return true;
  const path =
    fulfillment === 'PICKUP'
      ? ['PLACED', 'READY_FOR_PICKUP', 'COLLECTED']
      : ['PLACED', 'PROCESSING', 'SHIPPED', 'DELIVERED'];
  return path.indexOf(from) >= 0 && path[path.indexOf(from) + 1] === to;
}
