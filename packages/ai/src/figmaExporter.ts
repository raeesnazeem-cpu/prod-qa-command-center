import 'dotenv/config';
import { SupabaseClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

export interface FigmaFrame {
  frameId: string;
  frameName: string;
  imageUrl: string;
  pageUrl: string;
}

/**
 * Parses Figma URL to extract file key and optional node ID.
 */
function parseFigmaUrl(url: string): { fileKey: string; nodeId: string | null } {
  try {
    const u = new URL(url);
    const pathParts = u.pathname.split('/');
    const fileKeyIndex = pathParts.findIndex(part => part === 'design' || part === 'file') + 1;
    const fileKey = pathParts[fileKeyIndex];
    const nodeId = u.searchParams.get('node-id')?.replace(/-/g, ':');
    
    if (!fileKey) throw new Error('Invalid Figma URL: file key not found');
    return { fileKey, nodeId: nodeId || null };
  } catch (error) {
    throw new Error('Invalid Figma URL format');
  }
}

/**
 * Maps Figma frame names to site URLs.
 */
function mapFrameNameToUrl(name: string): string {
  const clean = name.toLowerCase().trim();
  if (clean === 'homepage' || clean === 'home' || clean === 'index') return '/';
  const slug = clean.replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
  return slug.startsWith('/') ? slug : `/${slug}`;
}

/**
 * exportFigmaFrames
 * Fetches frames from Figma, saves to Supabase Storage, and returns metadata.
 */
export async function exportFigmaFrames(
  figmaUrl: string, 
  figmaToken: string,
  supabase: SupabaseClient,
  runId: string
): Promise<FigmaFrame[]> {
  const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);
  const headers = { 'X-Figma-Token': figmaToken };

  // 1. Cache check: Has this runId already been exported?
  const { data: existingFiles } = await supabase.storage.from('screenshots').list(`figma/${runId}`);
  if (existingFiles && existingFiles.length > 0) {
    console.log(`Using cached Figma exports for run ${runId}`);
    const results: FigmaFrame[] = [];
    for (const file of existingFiles) {
      // frameId was stored as id.replace(/:/g, '_')
      const frameId = file.name.replace('.png', '').replace(/_/g, ':');
      const { data: signedData } = await supabase.storage
        .from('screenshots')
        .createSignedUrl(`figma/${runId}/${file.name}`, 31536000);

      // We don't have the original name in cache, but we can try to guess or use ID
      results.push({
        frameId,
        frameName: `Cached ${frameId}`,
        imageUrl: signedData?.signedUrl || '',
        pageUrl: '/' // Default to root for cache fallback
      });
    }
    return results;
  }

  let nodeIds: string[] = [];
  const frameMetadata: Record<string, { name: string }> = {};

  if (nodeId) {
    console.log(`Figma Exporter: Using specific node ID ${nodeId}`);
    nodeIds = [nodeId];
    frameMetadata[nodeId] = { name: 'Selected Frame' };
  } else {
    console.log(`Figma Exporter: Fetching entire file ${fileKey} to find frames`);
    const fileRes = await fetch(`https://api.figma.com/v1/files/${fileKey}`, { headers });
    if (!fileRes.ok) throw new Error(`Figma API error (files): ${fileRes.statusText}`);
    const fileData: any = await fileRes.json();
    
    const findFrames = (node: any) => {
      if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
        nodeIds.push(node.id);
        frameMetadata[node.id] = { name: node.name };
        return;
      }
      if (node.children) {
        node.children.forEach(findFrames);
      }
    };

    fileData.document.children.forEach((page: any) => {
      if (page.type === 'CANVAS') {
        findFrames(page);
      }
    });
    console.log(`Figma Exporter: Found ${nodeIds.length} candidate frames in file`);
  }

  if (nodeIds.length === 0) return [];

  // Get image URLs from Figma
  const encodedNodeIds = nodeIds.map(id => encodeURIComponent(id)).join(',');
  const imageRes = await fetch(
    `https://api.figma.com/v1/images/${fileKey}?ids=${encodedNodeIds}&format=png&scale=2`,
    { headers }
  );
  if (!imageRes.ok) throw new Error(`Figma API error (images): ${imageRes.statusText}`);
  const imageData: any = await imageRes.json();
  const imageUrls = imageData.images || {};
  console.log(`Figma Exporter: Figma returned ${Object.keys(imageUrls).length} image URLs`);

  const results: FigmaFrame[] = [];

  // Download each PNG and save to Supabase Storage
  for (const id of nodeIds) {
    const remoteUrl = imageUrls[id];
    if (!remoteUrl) {
      console.warn(`Figma Exporter: No image URL returned for node ID ${id}`);
      continue;
    }

    const imgRes = await fetch(remoteUrl);
    if (!imgRes.ok) continue;
    const buffer = await imgRes.arrayBuffer();

    const storagePath = `figma/${runId}/${id.replace(/:/g, '_')}.png`;
    const { error: uploadError } = await supabase.storage
      .from('screenshots')
      .upload(storagePath, buffer, {
        contentType: 'image/png',
        upsert: true
      });

    if (uploadError) {
      console.error(`Failed to upload frame ${id} to storage:`, uploadError);
      continue;
    }

    const { data: signedData, error: signedError } = await supabase.storage
      .from('screenshots')
      .createSignedUrl(storagePath, 31536000); // 1 year

    if (signedError || !signedData?.signedUrl) {
      console.error(`Failed to generate signed URL for frame ${id}:`, signedError);
      continue;
    }

    results.push({
      frameId: id,
      frameName: frameMetadata[id]?.name || 'Unknown',
      imageUrl: signedData.signedUrl,
      pageUrl: mapFrameNameToUrl(frameMetadata[id]?.name || '')
    });
  }

  return results;
}
