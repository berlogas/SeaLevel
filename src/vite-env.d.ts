/// <reference types="vite/client" />

// Разрешаем импорт любых CSS-файлов
declare module "*.css" {
  const content: string;
  export default content;
}
