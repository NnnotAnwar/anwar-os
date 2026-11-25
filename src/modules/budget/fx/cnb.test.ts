import { describe, expect, it } from "vitest"
import { dailyRequestDays, dailyUrl, monthlyUrl, parseCnbDate, parseCnbFile, parseCnbRate } from "./cnb"

// Trimmed copies of the real files (fetched 25 Nov 2026).
const DAILY_EN = `20 Nov 2026 #223
Country|Currency|Amount|Code|Rate
Australia|dollar|1|AUD|14.835
EMU|euro|1|EUR|24.470
Hungary|forint|100|HUF|6.545
Indonesia|rupiah|1000|IDR|1.226
Japan|yen|100|JPY|14.031
USA|dollar|1|USD|22.262
`

const DAILY_CS = "20.11.2026 #223\r\nzemě|měna|množství|kód|kurz\r\nEMU|euro|1|EUR|24,470\r\nJaponsko|jen|100|JPY|14,031\r\nUSA|dolar|1|USD|22,262\r\n"

const MONTHLY_EN = `30 Oct 2026 #10
Country|Currency|Amount|Code|Rate
Afghanistan|afghani|100|AFN|33.612
Kazakhstan|tenge|100|KZT|4.809
Ukraine|hryvna|100|UAH|48.123
Vietnam|dong|10000|VND|8.454
`

describe("ČNB files", () => {
  it("reads the English daily fixing (dot decimals, units per row)", () => {
    const file = parseCnbFile(DAILY_EN)
    expect(file?.date).toBe("2026-11-20")
    expect(file?.seq).toBe(223)
    expect(file?.rates).toContainEqual({ currency: "EUR", units: 1, rate: "24.470" })
    expect(file?.rates).toContainEqual({ currency: "JPY", units: 100, rate: "14.031" })
    expect(file?.rates).toContainEqual({ currency: "IDR", units: 1000, rate: "1.226" })
    expect(file?.rates).toHaveLength(6)
  })

  it("reads the Czech style too (DD.MM.YYYY, comma decimals, CRLF, Czech headers)", () => {
    const file = parseCnbFile(DAILY_CS)
    expect(file).toEqual({
      date: "2026-11-20",
      seq: 223,
      rates: [
        { currency: "EUR", units: 1, rate: "24.470" },
        { currency: "JPY", units: 100, rate: "14.031" },
        { currency: "USD", units: 1, rate: "22.262" },
      ],
    })
  })

  it("reads the monthly list of other currencies", () => {
    const file = parseCnbFile(MONTHLY_EN)
    expect(file?.date).toBe("2026-10-30")
    expect(file?.seq).toBe(10)
    expect(file?.rates).toContainEqual({ currency: "KZT", units: 100, rate: "4.809" })
    expect(file?.rates).toContainEqual({ currency: "VND", units: 10000, rate: "8.454" })
  })

  it("answers a weekend with the Friday fixing: the header date is what counts", () => {
    // daily.txt?date=22.11.2026 (a Sunday) returns the file of Friday the 20th.
    expect(parseCnbFile(DAILY_EN)?.date).toBe("2026-11-20")
  })

  it("returns null for an empty or broken file, and drops malformed rows", () => {
    expect(parseCnbFile("")).toBeNull() // the monthly file for a month not declared yet
    expect(parseCnbFile("<html>Service unavailable</html>")).toBeNull()
    expect(parseCnbFile("20 Nov 2026 #223\nCountry|Currency|Amount|Code|Rate\n")).toBeNull()
    expect(parseCnbFile("31 Nov 2026 #223\nCountry|Currency|Amount|Code|Rate\nEMU|euro|1|EUR|24.470")).toBeNull()
    const messy = parseCnbFile(
      "20 Nov 2026 #223\nCountry|Currency|Amount|Code|Rate\nEMU|euro|1|EUR|24.470\nX|y|3|ABC|1.0\nX|y|1|eu|1.0\nX|y|1|USD|-2\nX|y|1|GBP|1 234.5\nEMU|euro|1|EUR|99\nCzechia|koruna|1|CZK|1\nshort|row",
    )
    expect(messy?.rates).toEqual([{ currency: "EUR", units: 1, rate: "24.470" }])
  })

  it("parses dates and rates strictly", () => {
    expect(parseCnbDate("02 Jan 2026")).toBe("2026-01-02")
    expect(parseCnbDate("2.1.2026")).toBe("2026-01-02")
    expect(parseCnbDate("29 Feb 2026")).toBeNull()
    expect(parseCnbDate("Nov 20 2026")).toBeNull()
    expect(parseCnbRate("24,47")).toBe("24.47")
    expect(parseCnbRate("0.000")).toBeNull()
    expect(parseCnbRate("1.1234567")).toBeNull()
    expect(parseCnbRate("1,234.5")).toBeNull()
  })

  it("asks once per weekend (a Sunday answers Saturday and Friday), newest first", () => {
    // Mon 23, Sun 22, Sat 21, Fri 20, Thu 19 Nov 2026.
    expect(dailyRequestDays(["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"])).toEqual(["2026-11-23", "2026-11-22", "2026-11-19"])
    expect(dailyRequestDays(["2026-11-20", "2026-11-21"])).toEqual(["2026-11-21"])
    expect(dailyRequestDays(["2026-11-20", "2026-11-20", "2026-11-18"])).toEqual(["2026-11-20", "2026-11-18"])
    expect(dailyRequestDays([])).toEqual([])
  })

  it("builds the URLs: DD.MM.YYYY for a day; the month before for a monthly list", () => {
    expect(dailyUrl("2026-11-05")).toMatch(/daily\.txt\?date=05\.11\.2026$/)
    expect(monthlyUrl("2026-11")).toMatch(/fx_rates\.txt\?year=2026&month=10$/)
    expect(monthlyUrl("2027-01")).toMatch(/fx_rates\.txt\?year=2026&month=12$/)
  })
})
