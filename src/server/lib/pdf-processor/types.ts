export type TitleBlock = {
  projectName: string;
  projectNameType: string;
  projectNameNumber: string;
  drawingTitle: string;
  drawingNumber: string;
  sheetNumber: string;
  revision: string;
  designedBy?: string;
  drawnBy?: string;
  checkedBy?: string;
  scale: {
    ratio: string;
    units: string;
  };
};

export type EngineeringInfo = {
  disciplines: Discipline[];
  notes: string[];
  abbreviations: string[];
};

export type Discipline = {
  discipline: string;
  disciplineNumber: string;
};

export type Measurement = {
  description: string;
  value: number;
  unit: string;
};

export type OcrData = {
  fullText: string;
  addresses: string[];
  roads: string[];
  measurements: Measurement[];
  materials: string[];
  generalNotes: string[];
};

export type OcrResult = {
  titleBlock: TitleBlock;
  engineeringInfo: EngineeringInfo;
  ocrData: OcrData;
};

export type OcrPageRecord = {
  id: string;
  projectId: string;
  pageNumber: number;
  titleBlockJson: string;
  engineeringInfoJson: string;
  ocrDataJson: string;
  extractedAt: Date;
  ocrModel: string;
  retryCount: number;
  status: "pending" | "completed" | "failed";
};

export type ProjectRecord = {
  id: string;
  name: string;
  inputPath: string;
  optimizedPath: string;
  uploadedAt: Date;
  pageCount: number;
};

export type ProcessingStats = {
  total: number;
  completed: number;
  failed: number;
};
