/** Client-safe library types (no node imports, so the browser can share them). */

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  ext: string;
  sizeMB: number;
  /** folder that holds the file, shown as the "album" column */
  folder: string;
  hasLyric: boolean;
  hasTranslation: boolean;
}
