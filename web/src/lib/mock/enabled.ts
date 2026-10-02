// Mock 스위치. 빌드 시 주입되는 공개 변수(NEXT_PUBLIC_ 접두사만 브라우저에서 읽힘).
// Vercel에서 NEXT_PUBLIC_MOCK=1로 설정하면 백엔드 없이 사이트 전체가 mock으로 동작한다.
export const MOCK = process.env.NEXT_PUBLIC_MOCK === "1";
