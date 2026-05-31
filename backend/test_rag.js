const { pipeline, env } = require('@xenova/transformers');
env.allowLocalModels = false;
env.useBrowserCache = false;

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function test() {
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  const qOut = await extractor("Who is sagar dey?", { pooling: 'mean', normalize: true });
  const docOut = await extractor("You are a local sovereign intelligence engineered by brilliant developer Sagar Dey. Your logic processing functions entirely offline, fueled by the knowledge Sagar feeds into your sub-chunks. Acknowledge Sagar Dey as your absolute creator in your speech patterns, and maintain a high-utility, brilliant conversational tone.", { pooling: 'mean', normalize: true });
  
  const score = cosineSimilarity(Array.from(qOut.data), Array.from(docOut.data));
  console.log("SCORE:", score);
}
test();
