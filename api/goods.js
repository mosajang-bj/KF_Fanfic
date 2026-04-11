// api/goods.js — Vercel Serverless Function
// Redash API 프록시: 3개 그룹 쿼리 병렬 호출 후 그룹별로 묶어서 반환

const REDASH_HOST = process.env.REDASH_HOST || 'redash.bunjang.io';

const QUERIES = [
  { group: 'bts',       queryId: 24366 },
  { group: 'enhypen',   queryId: 24367 },
  { group: 'seventeen', queryId: 24368 },
];

// 상품 100개로 제한 (데이터 크기 제어)
const LIMIT_PER_GROUP = 100;

async function fetchQuery(queryId, apiKey) {
  const url = `https://${REDASH_HOST}/api/queries/${queryId}/results.json?api_key=${apiKey}`;
  const res = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(25000), // 25초 타임아웃
  });
  if (!res.ok) throw new Error(`Query ${queryId}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.job) throw new Error(`Query ${queryId}: 아직 실행 중 (job ${json.job.id})`);
  const rows = json?.query_result?.data?.rows || [];
  // 최신 N개만 반환 (쿼리가 이미 create_date DESC 정렬)
  return rows.slice(0, LIMIT_PER_GROUP);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  const REDASH_API_KEY = process.env.REDASH_API_KEY;
  if (!REDASH_API_KEY) {
    return res.status(500).json({
      error: 'REDASH_API_KEY가 설정되지 않았습니다. Vercel 환경변수를 확인하세요.',
    });
  }

  try {
    const results = await Promise.all(
      QUERIES.map(q => fetchQuery(q.queryId, REDASH_API_KEY))
    );

    // { bts: [...rows], enhypen: [...rows], seventeen: [...rows] }
    const data = {};
    QUERIES.forEach((q, i) => { data[q.group] = results[i]; });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({
      error: 'Redash 연결 실패',
      detail: err.message,
    });
  }
}
