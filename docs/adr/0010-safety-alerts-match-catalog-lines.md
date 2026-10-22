# 0010: Safety alerts match ferry bulletins to catalog lines

**Status:** accepted, 2026-10-22 (ticket 29)

## Context

Guests on the Dalmatian coast plan island trips and boat outings that a bura or a suspended line can spoil. Fetivi should tell them unprompted: official weather warnings, and ferry or catamaran disruptions that touch something in their plan or a booking.

There is no structured source for Croatian ferry disruptions. Ferryhopper's `get_disruptions` returned nothing for Croatia over a week (spike S3). Jadrolinija publishes bulletins in an RSS feed of free text, but polling it needs Jadrolinija's written permission (PRD §9). HAK, TP Line, Krilo and Bura Line offer only pages whose terms rule out scraping. DHMZ's CAP warnings are already parsed for `get_weather` (ticket 28).

A bulletin names line numbers ("Katamaranska linija 9603 …") and ports. Matching on place names would hit almost every item ("Split").

## Decision

- Day trips and transport notes in the catalog carry `ferry_lines`, ids from a static `FERRY_LINES` table, ticked by the admin. A plan item reaches its lines through its catalog place or its Offer's place; an Order through its Offer's place.
- A Jadrolinija bulletin touches a Space when it names a line one of the Space's items (today or later) depends on, on a day the bulletin names (else the day it was published). One alert per bulletin per Space, naming the earliest such item.
- Every DHMZ warning (yellow, orange, red) that covers the Property's warning areas and overlaps the Stay goes to every open Space of the Stay, possibly cancelled Stays included. A wind warning adds a sailing advisory when an item that depends on a line falls on a day it covers.
- The alert's facts (DHMZ's or Jadrolinija's own words, the line ids, the item) travel in the `guest-notify` job data; there is no alerts table. The key is `space:<id>:weather_warning:<type>:<level>:<onset>:<expires>` or `space:<id>:ferry_disruption:jadrolinija:<bulletinId>`, without language or advisory, so ADR 0007's ledger sends one alert per warning or bulletin per Space.
- The Jadrolinija feed stays behind `JADROLINIJA_RSS_ENABLED` (off), and its host joins the jobs egress allowlist only when the flag is on. Ferryhopper is not called.
- Fetivi never says a sailing is cancelled in its own voice. It quotes the bulletin title as published, links to it, and for an Order says the booking stands unless the Provider cancels it.

## Consequences

- The admin must tick the lines on each day trip and transport note; an unticked record never gets ferry alerts.
- A bulletin that names only ports, or a line missing from `FERRY_LINES`, matches nothing. Another destination adds rows to the table.
- A guest who adds a ferry item after a warning alert went out gets no second alert for that warning (one per warning per Space). An escalated or re-timed warning is a new key and a new alert.
- Until Jadrolinija gives permission, only weather warnings (and their sailing advisories) are sent.
