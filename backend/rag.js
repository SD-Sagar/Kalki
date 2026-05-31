const fs = require('fs');
const path = require('path');
const { pipeline, env } = require('@xenova/transformers');

// Configure transformers to download models to the local filesystem cache
env.allowLocalModels = false;
env.useBrowserCache = false;

// The Vector Store (Memory)
let vectorStore = [];
let extractor = null;

const STORAGE_DIR = path.join(__dirname, 'storage-backpack', 'chunk_1_active');

/**
 * Calculates the Cosine Similarity between two vectors.
 * Returns a score between -1 and 1. Closer to 1 means more similar.
 */
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

/**
 * Initializes the RAG engine and embeds all existing chunks in the backpack.
 */
async function initRAG() {
  console.log('[RAG] Initializing Vector Engine...');
  // Load the embedding model (downloads automatically on first run)
  extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('[RAG] Model loaded successfully.');

  // Scan storage-backpack for existing files
  if (fs.existsSync(STORAGE_DIR)) {
    const folders = fs.readdirSync(STORAGE_DIR);
    for (const folder of folders) {
      const folderPath = path.join(STORAGE_DIR, folder);
      if (fs.statSync(folderPath).isDirectory()) {
        const files = fs.readdirSync(folderPath);
        for (const file of files) {
          if (file.endsWith('.txt')) {
            const filePath = path.join(folderPath, file);
            const text = fs.readFileSync(filePath, 'utf-8');
            await addChunk(folder, text, filePath, false);
          }
        }
      }
    }
  }
  console.log(`[RAG] Bootup complete. Vector store holds ${vectorStore.length} chunks.`);
}

/**
 * Embeds text and adds it to the memory store.
 */
async function addChunk(subject, text, filePath = null, log = true) {
  if (!extractor) return;
  if (log) console.log(`[RAG] Embedding new chunk for subject: ${subject}`);
  
  // Generate embedding vector
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  const vector = Array.from(output.data);
  
  vectorStore.push({
    subject,
    text,
    filePath,
    vector
  });
}

/**
 * Searches the vector store for the most relevant chunks.
 */
async function search(query, topK = 2) {
  if (!extractor || vectorStore.length === 0) return "";
  
  console.log(`[RAG] Searching memory for query: "${query}"`);
  
  // Generate embedding for the user's query
  const output = await extractor(query, { pooling: 'mean', normalize: true });
  const queryVector = Array.from(output.data);
  
  // Calculate similarity for all stored chunks
  const results = vectorStore.map(item => {
    return {
      ...item,
      score: cosineSimilarity(queryVector, item.vector)
    };
  });
  
  // Sort by highest score first
  results.sort((a, b) => b.score - a.score);
  
  // Filter top K results and build the context string
  const topResults = results.slice(0, topK);
  
  let context = "";
  for (const res of topResults) {
    if (res.score > 0.3) { // Threshold to ignore completely irrelevant data
      context += `[Knowledge related to ${res.subject}]\n${res.text}\n\n`;
    }
  }
  
  return context.trim();
}

module.exports = {
  initRAG,
  addChunk,
  search
};
