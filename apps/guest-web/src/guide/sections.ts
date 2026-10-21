import type { BlockCategory } from '@fetivi/domain/vocabulary';
import {
  BookmarkSimple,
  DoorOpen,
  Heart,
  type Icon,
  Lifebuoy,
  Scroll,
  WifiHigh,
  Wrench,
} from '@phosphor-icons/react';

export interface GuideSectionInfo {
  category: BlockCategory;
  slug: string;
  icon: Icon;
}

/** The seven Guide sections, one per block category, in BLOCK_CATEGORIES order. */
export const GUIDE_SECTIONS: readonly GuideSectionInfo[] = [
  { category: 'arrival_access', slug: 'arrival', icon: DoorOpen },
  { category: 'wifi_essentials', slug: 'wifi', icon: WifiHigh },
  { category: 'house_rules_checkout', slug: 'rules', icon: Scroll },
  { category: 'how_tos', slug: 'how-tos', icon: Wrench },
  { category: 'saved_places', slug: 'saved', icon: BookmarkSimple },
  { category: 'host_picks', slug: 'picks', icon: Heart },
  { category: 'contacts_emergency', slug: 'contacts', icon: Lifebuoy },
];

export const sectionBySlug = (slug: string | undefined) =>
  GUIDE_SECTIONS.find((s) => s.slug === slug) ?? null;
