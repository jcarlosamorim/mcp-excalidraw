// O @types/node deste projeto é v20 e não conhece `node:sqlite`, que existe no
// runtime (Node 22.5+). Declaramos só a superfície usada em `projects.ts` em vez
// de subir a versão dos tipos e arrastar o resto do projeto junto.
declare module 'node:sqlite' {
  export interface StatementSync {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number; lastInsertRowid: number };
  }

  export class DatabaseSync {
    constructor(location: string, options?: { open?: boolean; readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
