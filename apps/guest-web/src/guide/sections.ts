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

/**
 * The Guide's three groups: the apartment itself, places (the host's and the guest's own), and
 * help. The group also sets the icon's tint: sea for the apartment, sun for people's picks, red
 * for emergencies.
 */
export type GuideGroup = 'stay' | 'places' | 'help';

export interface GuideSectionInfo {
  category: BlockCategory;
  slug: string;
  icon: Icon;
  group: GuideGroup;
}

/** The seven Guide sections, one per block category, in BLOCK_CATEGORIES order. */
export const GUIDE_SECTIONS: readonly GuideSectionInfo[] = [
  { category: 'arrival_access', slug: 'arrival', icon: DoorOpen, group: 'stay' },
  { category: 'wifi_essentials', slug: 'wifi', icon: WifiHigh, group: 'stay' },
  { category: 'house_rules_checkout', slug: 'rules', icon: Scroll, group: 'stay' },
  { category: 'how_tos', slug: 'how-tos', icon: Wrench, group: 'stay' },
  { category: 'saved_places', slug: 'saved', icon: BookmarkSimple, group: 'places' },
  { category: 'host_picks', slug: 'picks', icon: Heart, group: 'places' },
  { category: 'contacts_emergency', slug: 'contacts', icon: Lifebuoy, group: 'help' },
];

export const GUIDE_GROUPS: readonly GuideGroup[] = ['stay', 'places', 'help'];

export const sectionBySlug = (slug: string | undefined) =>
  GUIDE_SECTIONS.find((s) => s.slug === slug) ?? null;
