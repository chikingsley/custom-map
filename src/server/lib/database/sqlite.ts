import Database from "bun:sqlite";
import type { OcrPageRecord, ProjectRecord } from "../pdf-processor/types";

const dbPath = process.env.DB_PATH || "./data/ocr.db";
const db = new Database(dbPath);

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      input_path TEXT NOT NULL,
      optimized_path TEXT NOT NULL,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      page_count INTEGER
    );

    CREATE TABLE IF NOT EXISTS ocr_pages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      title_block TEXT NOT NULL,
      engineering_info TEXT,
      ocr_data TEXT NOT NULL,
      extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ocr_model TEXT DEFAULT 'gemini-3-flash-preview',
      retry_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_project_pages 
      ON ocr_pages(project_id, page_number);
    
    CREATE INDEX IF NOT EXISTS idx_status 
      ON ocr_pages(status);
  `);

  console.log("[Database] Initialized");
}

export function createProject(
  project: Omit<ProjectRecord, "uploaded_at">
): void {
  const stmt = db.prepare(`
    INSERT INTO projects (id, name, input_path, optimized_path, page_count)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(
    project.id,
    project.name,
    project.inputPath,
    project.optimizedPath,
    project.pageCount
  );
}

export function getProject(projectId: string): ProjectRecord | undefined {
  const stmt = db.prepare("SELECT * FROM projects WHERE id = ?");
  const row = stmt.get(projectId) as
    | {
        id: string;
        name: string;
        input_path: string;
        optimized_path: string;
        uploaded_at: string;
        page_count: number;
      }
    | undefined;

  if (!row) {
    return;
  }

  return {
    id: row.id,
    name: row.name,
    inputPath: row.input_path,
    optimizedPath: row.optimized_path,
    uploadedAt: new Date(row.uploaded_at),
    pageCount: row.page_count,
  };
}

export function createOcrPage(page: Omit<OcrPageRecord, "extracted_at">): void {
  const stmt = db.prepare(`
    INSERT INTO ocr_pages (
      id, project_id, page_number, title_block,
      engineering_info, ocr_data, ocr_model, status, retry_count
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    page.id,
    page.projectId,
    page.pageNumber,
    JSON.stringify(page.titleBlock),
    JSON.stringify(page.engineeringInfo),
    JSON.stringify(page.ocrData),
    page.ocrModel,
    page.status,
    page.retryCount
  );
}

export function updateOcrPageStatus(
  pageId: string,
  status: OcrPageRecord["status"]
): void {
  const stmt = db.prepare("UPDATE ocr_pages SET status = ? WHERE id = ?");
  stmt.run(status, pageId);
}

export function getOcrPages(projectId: string): OcrPageRecord[] {
  const stmt = db.prepare(`
    SELECT * FROM ocr_pages 
    WHERE project_id = ? 
    ORDER BY page_number
  `);

  const results = stmt.all(projectId) as OcrPageRecord[];
  return results;
}

export function closeDatabase(): void {
  db.close();
}
