import type { ManualExtractionData } from './schema';

/** A realistic house manual for the live test, the API tests and manual checks. */
export const SAMPLE_MANUAL = `Welcome to Apartman Mare, Trogir!

Dear guests, dobrodošli! We are Ana and Marko, and we are happy to have you with us.

ARRIVAL
Check-in is from 15:00. The apartment is in Ulica Matije Gupca 12, 21220 Trogir, on the first floor of the stone house behind the Konzum shop.
There is no key: the apartment door has a keypad. Type 4821# and push the door. If you arrive late, the code works all night.
Parking is in the street in front of the house and it is free. In July and August come before 18:00 to find a place.

WI-FI
The network is MareGuest and the password is sunce2024. The router is on the shelf in the hall; if the internet stops, unplug it for ten seconds.

AIR CONDITIONING
The apartment has air conditioning in the living room and in the bedroom.
1. Take the white remote from the drawer under the TV.
2. Press ON/OFF and choose MODE: snowflake for cooling.
3. Set 24 degrees, it is enough and saves energy.
4. Please close the windows and the balcony door when the AC is on, and switch it off when you go out.

KITCHEN
The kitchen has an oven, a dishwasher, a microwave and a coffee maker. Coffee capsules for the first morning are in the cupboard above the sink.

HOUSE RULES
- No smoking inside the apartment. You can smoke on the balcony.
- Quiet hours are from 22:00 to 07:00, our neighbours are old people.
- No parties please.

RUBBISH
Rubbish goes in the green containers at the end of the street. Plastic and glass go in the yellow and blue containers next to them. Please do not leave bags in front of the door, the cats open them.

CHECKOUT
Checkout is by 10:00. Before you leave, please put the used towels in the bathtub, take out the rubbish, close all windows and leave the key card on the kitchen table.

OUR TIPS
The nicest beach near us is Pantan, 15 minutes walking east along the sea. It has shade under the pines and a small bar.
For dinner try Konoba Trs in the old town, ask for the black risotto.
The fish market opens at 6:00 next to the bridge, go early for the best fish.

PHARMACY AND DOCTOR
The pharmacy Ljekarna Trogir is on the main square, open every day until 21:00. In an emergency call 112, the ambulance is 194. The nearest hospital is KBC Split, 30 minutes by car.

CONTACT
If you need anything, call or send a WhatsApp message to Ana on +385 91 234 5678. We live in Split and can come in 30 minutes.

Our cat Mici sometimes visits the terrace, please don't feed her, she is on a diet!

Enjoy Trogir and polako!
Ana & Marko`;

/** An extraction with nothing stated, for tests to override. */
export function emptyExtraction(): ManualExtractionData {
  return {
    fields: {
      addressLine: null,
      city: null,
      postalCode: null,
      buildingDoorCode: null,
      checkInTime: null,
      checkoutTime: null,
      checkInMethod: null,
      accessInstructions: null,
      parkingType: null,
      parkingNotes: null,
      petsAllowed: null,
      smokingAllowed: null,
      partiesAllowed: null,
      quietHoursFrom: null,
      quietHoursTo: null,
      houseRulesNotes: null,
      hostPhone: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      licenceNumber: null,
      noWifi: null,
      wifiNetwork: null,
      wifiPassword: null,
      doorCode: null,
      lockboxCode: null,
      maxOccupancy: null,
      bedrooms: null,
      bathrooms: null,
      beds: [],
    },
    amenities: [],
    blocks: [],
    unmapped: [],
  };
}

/**
 * What the model returns for SAMPLE_MANUAL, for the stubbed model in tests. Taken from a live
 * run, except that the Wi-Fi block echoes the password, so the secret scrub has work to do.
 */
export function sampleExtraction(): ManualExtractionData {
  const base = emptyExtraction();
  return {
    fields: {
      ...base.fields,
      addressLine: 'Ulica Matije Gupca 12',
      city: 'Trogir',
      postalCode: '21220',
      checkInTime: '15:00',
      checkoutTime: '10:00',
      checkInMethod: 'keypad',
      accessInstructions:
        'There is no key: the apartment door has a keypad. Find the code in your arrival details.',
      parkingType: 'free_street',
      parkingNotes: 'In July and August come before 18:00 to find a place.',
      smokingAllowed: false,
      partiesAllowed: false,
      quietHoursFrom: '22:00',
      quietHoursTo: '07:00',
      houseRulesNotes: 'You can smoke on the balcony.',
      hostPhone: '+385 91 234 5678',
      wifiNetwork: 'MareGuest',
      wifiPassword: 'sunce2024',
      doorCode: '4821#',
    },
    amenities: [
      { amenity: 'ac', note: 'In the living room and in the bedroom.' },
      { amenity: 'dishwasher', note: null },
      { amenity: 'coffee_maker', note: null },
    ],
    blocks: [
      {
        category: 'arrival_access',
        wizardKey: 'arrival_directions',
        title: 'Getting in',
        body: 'The apartment is on the first floor of the stone house behind the Konzum shop.\n\nThe keypad code is in your arrival details.',
      },
      {
        category: 'wifi_essentials',
        wizardKey: null,
        title: 'Wi-Fi router',
        body: 'The router is on the shelf in the hall. The password is sunce2024. If the internet stops, unplug it for ten seconds.',
      },
      {
        category: 'how_tos',
        wizardKey: 'heating_cooling',
        title: 'Air conditioning',
        body: '1. Take the white remote from the drawer under the TV.\n2. Press ON/OFF and choose MODE: snowflake for cooling.\n3. Set 24 degrees.',
      },
      {
        category: 'host_picks',
        wizardKey: 'neighbourhood_tips',
        title: 'Our tips',
        body: '- **Pantan beach:** 15 minutes walking east along the sea.\n- **Dinner:** Konoba Trs in the old town.',
      },
    ],
    unmapped: [
      "Our cat Mici sometimes visits the terrace, please don't feed her, she is on a diet!",
    ],
  };
}
