import { create } from 'zustand';

interface GalleryStoreState {
  galleryImages: Record<string, string[]>; // finding_id -> image URLs
  addImage: (findingId: string, imageUrl: string) => void;
  setGalleryImages: (findingId: string, images: string[]) => void;
  clearGallery: (findingId: string) => void;
  clearAllGalleries: () => void;
}

export const useGalleryStore = create<GalleryStoreState>((set) => ({
  galleryImages: {},
  addImage: (findingId, imageUrl) => set((state) => {
    const currentImages = state.galleryImages[findingId] || [];
    if (currentImages.length >= 3) return state;
    return {
      galleryImages: {
        ...state.galleryImages,
        [findingId]: [...currentImages, imageUrl]
      }
    };
  }),
  setGalleryImages: (findingId, images) => set((state) => ({
    galleryImages: {
      ...state.galleryImages,
      [findingId]: images.slice(0, 3)
    }
  })),
  clearGallery: (findingId) => set((state) => {
    const newGalleries = { ...state.galleryImages };
    delete newGalleries[findingId];
    return { galleryImages: newGalleries };
  }),
  clearAllGalleries: () => set({ galleryImages: {} })
}));
