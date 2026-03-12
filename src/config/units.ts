export const UNITS = {
  piece: { label: "pcs", allowDecimal: false },
  kg: { label: "kg", allowDecimal: true },
  gram: { label: "g", allowDecimal: true },
  liter: { label: "L", allowDecimal: true },
  meter: { label: "m", allowDecimal: true },
  dozen: { label: "doz", allowDecimal: false },
  box: { label: "box", allowDecimal: false },
  pack: { label: "pack", allowDecimal: false },
} as const;

export type UnitType = keyof typeof UNITS;

export const VALID_UNITS = Object.keys(UNITS) as UnitType[];

export function isValidUnit(unit: string): unit is UnitType {
  return unit in UNITS;
}

export function allowsDecimal(unit: UnitType): boolean {
  return UNITS[unit].allowDecimal;
}

export function unitLabel(unit: UnitType): string {
  return UNITS[unit].label;
}
