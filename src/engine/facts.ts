import { Fact } from '../types/domain';

export function formatFactValue(value: number, unit: Fact['unit']): string {
  switch (unit) {
    case 'USD': {
      const abs = Math.abs(value);
      const formatted = abs.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
      return value < 0 ? `-$${formatted}` : `$${formatted}`;
    }
    case 'units':
      return `${Math.round(value).toLocaleString('en-US')} units`;
    case 'weeks':
      return `${value.toFixed(1)} wks`;
    case 'percent': {
      const sign = value > 0 ? '+' : '';
      return `${sign}${value.toFixed(1)}%`;
    }
    case 'share_percent':
      return `${value.toFixed(1)}%`;
    case 'points': {
      const sign = value > 0 ? '+' : '';
      return `${sign}${value.toFixed(1)} pts`;
    }
    case 'days':
      return `${Math.round(value)} days`;
    case 'count':
      return `${Math.round(value)}`;
  }
}

export function createFact(
  id: string,
  label: string,
  value: number,
  unit: Fact['unit'],
  note: string,
): Fact {
  return {
    id,
    label,
    value,
    formatted: formatFactValue(value, unit),
    unit,
    note,
  };
}
