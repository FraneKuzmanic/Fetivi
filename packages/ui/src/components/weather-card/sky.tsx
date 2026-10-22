import type { SkyCode } from '@fetivi/domain/weather-vocabulary';
import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  type Icon,
  Sun,
} from '@phosphor-icons/react';

/** One line icon per sky; one family, the regular weight. Sleet shares the snow cloud. */
export const SKY_ICONS: Record<SkyCode, Icon> = {
  clear: Sun,
  partly_cloudy: CloudSun,
  cloudy: Cloud,
  fog: CloudFog,
  light_rain: CloudRain,
  rain: CloudRain,
  heavy_rain: CloudRain,
  showers: CloudRain,
  thunder: CloudLightning,
  sleet: CloudSnow,
  snow: CloudSnow,
};
