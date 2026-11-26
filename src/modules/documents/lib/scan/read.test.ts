import { describe, expect, it } from "vitest"
import { datesIn, findMrz, kindFromCode, kindFromText, mrzLine, readCard } from "./read"

const TODAY = "2026-11-27"

/** ICAO 9303 check digit (weights 7, 3, 1; < = 0, A = 10 … Z = 35). */
function check(s: string) {
  const value = (c: string) => (c === "<" ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55)
  return String([...s].reduce((sum, c, i) => sum + value(c) * [7, 3, 1][i % 3]!, 0) % 10)
}

/** A TD1 card (ID card, residence permit): 3 × 30 characters with real check digits. */
function td1(code: string, number: string, born: string, expires: string) {
  const l1 = `${code.padEnd(2, "<")}CZE${number}${check(number)}`.padEnd(30, "<")
  const l2body = `${born}${check(born)}M${expires}${check(expires)}UKR`.padEnd(29, "<")
  const composite = check(l1.slice(5, 30) + l2body.slice(0, 7) + l2body.slice(8, 15) + l2body.slice(18, 29))
  return [l1, `${l2body}${composite}`, "TESTOV<<IVAN<<<<<<<<<<<<<<<<<"]
}

describe("findMrz", () => {
  it("reads a residence permit's MRZ and checks the expiry", () => {
    const mrz = findMrz(td1("IR", "RA1234567", "950312", "310315").join("\n"), TODAY)
    expect(mrz).toMatchObject({ format: "TD1", documentCode: "IR", expiresOn: "2031-03-15", bornOn: "1995-03-12", checked: true })
  })

  it("survives the usual OCR slips: spaces, « for <, O for 0, dropped filler", () => {
    const [l1, l2, l3] = td1("IR", "RA1234567", "950312", "310315")
    const ocr = [l1!.replace(/<+$/, "").split("").join(" "), l2!.replace(/0/g, "O").replace(/</g, "«"), `  ${l3!.slice(0, 20)}`].join("\n")
    const mrz = findMrz(`Some printed text above\n${ocr}\n`, TODAY)
    expect(mrz?.expiresOn).toBe("2031-03-15")
    expect(mrz?.checked).toBe(true)
  })

  it("reads a passport's two 44-character lines", () => {
    const number = "C12345678"
    const born = "880101"
    const expires = "330601"
    const l1 = "P<CZETESTOVA<<JANA<<<<<<<<<<<<<<<<<<<<<<<<<<"
    const optional = "<<<<<<<<<<<<<<"
    const body = `${number}${check(number)}CZE${born}${check(born)}F${expires}${check(expires)}${optional}${check(optional)}`
    const composite = check(body.slice(0, 10) + body.slice(13, 20) + body.slice(21, 43))
    const mrz = findMrz(`${l1}\n${body}${composite}`, TODAY)
    expect(mrz).toMatchObject({ format: "TD3", documentCode: "P", expiresOn: "2033-06-01", checked: true })
  })

  it("finds nothing in plain text", () => {
    expect(findMrz("REPUBLIKA\nPOVOLENÍ K POBYTU\n15.03.2031", TODAY)).toBeNull()
  })

  it("cleans an OCR line to MRZ characters", () => {
    expect(mrzLine("ir cze« ra12 3")).toBe("IRCZE<RA123")
  })
})

describe("kinds", () => {
  it("from the MRZ document code", () => {
    expect(kindFromCode("P")).toBe("passport")
    expect(kindFromCode("PO")).toBe("passport")
    expect(kindFromCode("IR")).toBe("residence_permit")
    expect(kindFromCode("AR")).toBe("residence_permit")
    expect(kindFromCode("ID")).toBe("id_card")
    expect(kindFromCode("I")).toBe("id_card")
    expect(kindFromCode("V")).toBeNull()
  })

  it("from printed titles, with or without diacritics", () => {
    expect(kindFromText("POVOLENI K POBYTU / RESIDENCE PERMIT")).toBe("residence_permit")
    expect(kindFromText("ŘIDIČSKÝ PRŮKAZ")).toBe("driving_licence")
    expect(kindFromText("EUROPEAN HEALTH INSURANCE CARD")).toBe("insurance")
    expect(kindFromText("CESTOVNI PAS PASSPORT")).toBe("passport")
    expect(kindFromText("Hello")).toBeNull()
  })
})

describe("datesIn", () => {
  it("finds the usual printed forms", () => {
    expect(datesIn("15.03.2031 and 1/2/2024, 2030-12-24, 05 06 2029, 12 JAN 2030, 3 MAR/MARS 2028").map((d) => d.iso)).toEqual([
      "2031-03-15",
      "2024-02-01",
      "2030-12-24",
      "2029-06-05",
      "2030-01-12",
      "2028-03-03",
    ])
  })

  it("skips impossible dates", () => {
    expect(datesIn("31.02.2030 99.99.2030")).toEqual([])
  })
})

describe("readCard", () => {
  it("a residence permit: kind and expiry from the back's MRZ, issue date from the printed text", () => {
    const front = { text: "ČESKÁ REPUBLIKA\nPOVOLENÍ K POBYTU\nRESIDENCE PERMIT\nPLATNOST/VALIDITY 15.03.2031\n12.03.1995" }
    const back = {
      text: "DATUM VYDÁNÍ / DATE OF ISSUE\n20.02.2026\nPOZNÁMKY",
      mrzText: td1("IR", "RA1234567", "950312", "310315").join("\n"),
    }
    expect(readCard([front, back], TODAY)).toEqual({
      kind: "residence_permit",
      expiresOn: "2031-03-15",
      issuedOn: "2026-02-20",
      expirySource: "mrz",
      mrzPhoto: 1,
    })
  })

  it("without an MRZ: the labelled dates, the birth date never taken for the issue date", () => {
    const licence = { text: "ŘIDIČSKÝ PRŮKAZ\n3. 12.04.1990 PRAHA\n4a. 05.06.2019\n4b. 05.06.2029\nDATE OF BIRTH 12.04.1990" }
    expect(readCard([licence], TODAY)).toMatchObject({
      kind: "driving_licence",
      expiresOn: "2029-06-05",
      issuedOn: "2019-06-05",
      expirySource: "text",
      mrzPhoto: null,
    })
  })

  it("prefers the labelled expiry over a later unrelated date", () => {
    const card = { text: "VALID UNTIL 01.01.2030\nNEXT CHECK 01.01.2035" }
    expect(readCard([card], TODAY).expiresOn).toBe("2030-01-01")
  })

  it("never takes a printed title for an MRZ (POVOLENI… isn't a passport's P)", () => {
    const front = { text: "CESKA REPUBLIKA\nPOVOLENI K POBYTU\nRESIDENCE PERMIT\nTYP POVOLENI DLOUHODOBY POBYT\nPLATNOST 15.03.2031" }
    expect(readCard([front], TODAY)).toMatchObject({ kind: "residence_permit", expiresOn: "2031-03-15", mrzPhoto: null })
  })

  it("reads nothing from nothing", () => {
    expect(readCard([{ text: "" }], TODAY)).toEqual({ kind: null, expiresOn: null, issuedOn: null, expirySource: null, mrzPhoto: null })
  })
})
