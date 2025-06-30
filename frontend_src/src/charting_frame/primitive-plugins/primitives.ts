
/**
 * Small File to create a <string, Class> Map. Unfortunately this cannot exist in primitive-base.ts
 * due to circular import errors.
 */

import { PrimitiveBase } from './primitive-base';
import { TrendLine } from './trend-line/trend-line';


export const primitives:Map<string, new(id:string, params:any) => PrimitiveBase> = new Map([
    ['TrendLine', TrendLine]
]) 