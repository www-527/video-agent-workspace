export type ChartType =
  | 'bar'
  | 'grouped-bar'
  | 'stacked-bar'
  | 'line'
  | 'area'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'progress';

export interface ChartDatum {
  label: string;
  value: number;
  series?: string;
  x?: number;
  y?: number;
  size?: number;
}

export interface ChartSpec {
  type: ChartType;
  title?: string;
  data: ChartDatum[];
  unit?: string;
  min?: number;
  max?: number;
  showLegend?: boolean;
  showValues?: boolean;
  source?: string;
}

export type ChartIssueCode =
  | 'chart_invalid_data'
  | 'chart_invalid_total'
  | 'chart_invalid_scale'
  | 'chart_unsuitable_type';

export interface ChartIssue {
  code: ChartIssueCode;
  severity: 'critical' | 'major';
  detail: string;
}

export interface ChartValidationResult {
  valid: boolean;
  issues: ChartIssue[];
  normalized?: ChartSpec;
}
