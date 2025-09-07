"use client";
import React, { useMemo, useState } from "react";

/** ============ Types ============ */
interface Entry {
  date: string; // ISO 'YYYY-MM-DD'
  names: string[];
}

type DateFormat = "MM/DD" | "YYYY.MM.DD";

/** ============ Helpers ============ */
const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const toISO = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (iso: string, n: number) => {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
const isConsecutive = (a: string, b: string) => addDays(a, 1) === b;

const formatDate = (iso: string, fmt: DateFormat) => {
  const d = fromISO(iso);
  if (fmt === "MM/DD") return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};

const classNames = (...xs: (string | false | undefined)[]) =>
  xs.filter(Boolean).join(" ");

const uniqueSorted = <T,>(arr: T[]) => Array.from(new Set(arr));

/** ============ Calendar ============ */
function buildCalendarMatrix(year: number, monthIndex: number) {
  const first = new Date(year, monthIndex, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay()); // Sun-first
  const matrix: string[][] = [];
  const cursor = new Date(start);
  for (let w = 0; w < 6; w++) {
    const row: string[] = [];
    for (let d = 0; d < 7; d++) {
      row.push(toISO(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    matrix.push(row);
  }
  return matrix;
}

/** ============ Aggregation ============ */
/**
 * aggregateByPerson
 * - mergeAllSpan=false: 인접 날짜만 병합 (틈 유지)
 * - mergeAllSpan=true: 선택 날짜가 흩어져 있어도 최소~최대로 하나의 구간으로 병합
 * - 반환값에 각 사람의 'datesKey'(정렬된 ISO 리스트)도 포함하여, rowSpan 병합 시 문자열 대신 날짜세트로 그룹핑.
 */
// 기존 aggregateByPerson(entries, fmt, mergeAllSpan) 함수 전체를 이걸로 교체
function aggregateByPerson(
  entries: Entry[],
  fmt: DateFormat,
  mergeAllSpan: boolean
) {
  // name -> ISO 날짜들
  const m = new Map<string, string[]>();
  for (const e of entries) {
    for (const nm of e.names) {
      if (!nm) continue;
      const arr = m.get(nm) ?? [];
      arr.push(e.date);
      m.set(nm, arr);
    }
  }
  // 정렬 + 중복 제거
  for (const [k, arr] of m) {
    arr.sort();
    m.set(k, uniqueSorted(arr));
  }

  type Row = {
    name: string;
    periods: string;
    days: number; // ✅ 실제 선택된 날짜 수
    datesKey: string; // rowSpan 병합용 정규화 키
  };

  const out: Row[] = [];

  for (const [name, dates] of m) {
    if (dates.length === 0) continue;

    // ✅ days는 무조건 '선택된 날짜 개수'
    const selectedCount = dates.length;

    // 기간 표시는 옵션에 따라
    let segments: [string, string][];
    if (mergeAllSpan) {
      // 최소~최대 한 구간으로 표기만 병합 (일수는 selectedCount 사용)
      segments = [[dates[0], dates[dates.length - 1]]];
    } else {
      // 인접 날짜만 병합
      segments = [];
      let start = dates[0];
      let prev = dates[0];
      for (let i = 1; i < dates.length; i++) {
        const cur = dates[i];
        if (isConsecutive(prev, cur)) {
          prev = cur;
        } else {
          segments.push([start, prev]);
          start = prev = cur;
        }
      }
      segments.push([start, prev]);
    }

    // 포맷팅 (표시는 기존과 동일)
    const formatted = segments.map(([s, e]) =>
      s === e
        ? `${formatDate(s, fmt)}`
        : `${formatDate(s, fmt)}~${formatDate(e, fmt)}`
    );

    // 날짜세트 키 (문자열 표기와 무관하게 동일 날짜면 병합됨)
    const datesKey = dates.join(",");

    out.push({
      name,
      periods: formatted.join(", "),
      days: selectedCount, // ✅ 여기!
      datesKey,
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return out;
}

/** ============ Component ============ */
export default function AttendancePlanner() {
  const today = new Date();
  const [year, setYear] = useState<number>(today.getFullYear());
  const [month, setMonth] = useState<number>(today.getMonth()); // 0-11

  // 날짜 선택: 개별 토글 방식 유지
  const [selectedDates, setSelectedDates] = useState<string[]>([]);

  // 입력 데이터
  const [entries, setEntries] = useState<Entry[]>([]);
  const [tempInputs, setTempInputs] = useState<Record<string, string>>({});

  // 표기/병합 옵션
  const [fmt, setFmt] = useState<DateFormat>("YYYY.MM.DD");
  const [mergeAllSpan] = useState<boolean>(false);

  const matrix = useMemo(() => buildCalendarMatrix(year, month), [year, month]);
  const monthLabel = useMemo(() => `${year}.${pad(month + 1)}`, [year, month]);

  function toggleDate(iso: string) {
    setSelectedDates((prev) => {
      const has = prev.includes(iso);
      const next = has ? prev.filter((d) => d !== iso) : [...prev, iso];
      return next.sort();
    });
  }

  function ensureEntry(dateISO: string) {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.date === dateISO);
      if (idx !== -1) return prev;
      const next = [...prev, { date: dateISO, names: [] }];
      next.sort((a, b) => a.date.localeCompare(b.date));
      return next;
    });
  }

  function addNamesToDate(dateISO: string, raw: string) {
    const names = uniqueSorted(
      raw
        .split(/[\n,、，;；\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
    if (names.length === 0) return;
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.date === dateISO);
      const base = idx === -1 ? { date: dateISO, names: [] } : prev[idx];
      const merged = uniqueSorted([...base.names, ...names]);
      const next = [...prev];
      if (idx === -1) next.push({ date: dateISO, names: merged });
      else next[idx] = { ...base, names: merged };
      next.sort((a, b) => a.date.localeCompare(b.date));
      return next;
    });
    setTempInputs((p) => ({ ...p, [dateISO]: "" }));
  }

  function removeName(dateISO: string, name: string) {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.date === dateISO);
      if (idx === -1) return prev;
      const left = prev[idx].names.filter((n) => n !== name);
      const next = [...prev];
      next[idx] = { ...prev[idx], names: left };
      return next;
    });
  }

  // 집계 (옵션 적용)
  const byPerson = useMemo(
    () => aggregateByPerson(entries, fmt, mergeAllSpan),
    [entries, fmt, mergeAllSpan]
  );

  /** 동일 날짜세트(정규화된 datesKey) + days 기준으로 병합 (rowSpan) */
  const groupedForRowSpan = useMemo(() => {
    const groups: Record<
      string,
      { name: string; periods: string; days: number; datesKey: string }[]
    > = {};
    for (const r of byPerson) {
      const key = `${r.datesKey}|${r.days}`;
      (groups[key] ??= []).push(r);
    }
    // 그룹 내 이름 정렬
    for (const k of Object.keys(groups)) {
      groups[k].sort((a, b) => a.name.localeCompare(b.name, "ko"));
    }
    return groups;
  }, [byPerson]);

  return (
    <div className="mx-auto max-w-6xl p-4 space-y-6">
      <h1 className="text-2xl font-bold">점검 참여자 집계 도구</h1>

      {/* Controls */}
      <div className="grid md:grid-cols-3 gap-4">
        {/* Calendar */}
        <div className="border rounded-2xl p-3 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <button
              className="px-3 py-1 rounded-xl border"
              onClick={() => {
                const d = new Date(year, month - 1, 1);
                setYear(d.getFullYear());
                setMonth(d.getMonth());
              }}
            >
              ←
            </button>
            <div className="font-semibold">{monthLabel}</div>
            <button
              className="px-3 py-1 rounded-xl border"
              onClick={() => {
                const d = new Date(year, month + 1, 1);
                setYear(d.getFullYear());
                setMonth(d.getMonth());
              }}
            >
              →
            </button>
          </div>

          <div className="grid grid-cols-7 text-center text-sm">
            {["일", "월", "화", "수", "목", "금", "토"].map((w) => (
              <div key={w} className="py-1 font-medium">
                {w}
              </div>
            ))}

            {matrix.flat().map((iso) => {
              const d = fromISO(iso);
              const isCurrentMonth = d.getMonth() === month;
              const selected = selectedDates.includes(iso);
              const hasNames = entries.find((e) => e.date === iso);
              return (
                <button
                  key={iso}
                  onClick={() => toggleDate(iso)}
                  className={classNames(
                    "h-16 border flex flex-col items-center justify-start p-1 hover:bg-gray-50",
                    !isCurrentMonth && "bg-gray-50 text-gray-400",
                    selected && "ring-2 ring-blue-400 bg-blue-50",
                    hasNames && !selected && "bg-blue-100"
                  )}
                  title={iso}
                >
                  <div className="text-xs">{d.getDate()}</div>
                  <div className="text-[10px] line-clamp-2 leading-tight">
                    {hasNames?.names.join(", ")}
                  </div>
                </button>
              );
            })}
          </div>

          {/* 선택된 날짜 프리뷰 */}
          <div className="mt-3 text-sm">
            선택된 날짜:{" "}
            {selectedDates.length
              ? selectedDates.map((d) => formatDate(d, fmt)).join(", ")
              : "-"}
          </div>
        </div>

        {/* Settings */}
        <div className="border rounded-2xl p-3 shadow-sm space-y-4">
          <div>
            <div className="text-sm font-medium mb-1">날짜 표기 형식</div>
            <div className="flex gap-3">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="fmt"
                  checked={fmt === "MM/DD"}
                  onChange={() => setFmt("MM/DD")}
                />
                <span>00/00</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="fmt"
                  checked={fmt === "YYYY.MM.DD"}
                  onChange={() => setFmt("YYYY.MM.DD")}
                />
                <span>00.00.00</span>
              </label>
            </div>

            {/* 구간 병합 방식 토글 */}
            {/* <div>
              <div className="text-sm font-medium mb-1">구간 병합 방식</div>
              <div className="flex gap-3">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="merge-mode"
                    checked={!mergeAllSpan}
                    onChange={() => setMergeAllSpan(false)}
                  />
                  <span>틈 유지</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="merge-mode"
                    checked={mergeAllSpan}
                    onChange={() => setMergeAllSpan(true)}
                  />
                  <span>연속 병합</span>
                </label>
              </div>
            </div> */}
          </div>

          <button
            className="w-full rounded-xl border py-2 hover:bg-gray-50"
            onClick={() => {
              setEntries([]);
              setSelectedDates([]);
              setTempInputs({});
            }}
          >
            전체 초기화
          </button>
        </div>

        {/* 날짜별 이름 입력: 선택된 날짜만 */}
        <div className="border rounded-2xl p-3 shadow-sm">
          <div className="text-sm font-medium mb-2">날짜별 이름 입력</div>
          <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
            {selectedDates.length === 0 && (
              <div className="text-gray-400 text-sm">
                달력에서 날짜들을 클릭해 선택하세요. (다중 선택/해제)
              </div>
            )}
            {selectedDates.map((iso) => {
              const e = entries.find((x) => x.date === iso);
              const value = tempInputs[iso] ?? "";
              return (
                <div key={iso} className="border rounded-xl p-2">
                  <div className="text-xs mb-1">{formatDate(iso, fmt)}</div>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 border rounded-xl px-2 py-1"
                      placeholder="이름 추가 (쉼표/공백/줄바꿈 허용)"
                      value={value}
                      onChange={(ev) =>
                        setTempInputs((p) => ({ ...p, [iso]: ev.target.value }))
                      }
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" && !ev.shiftKey) {
                          ev.preventDefault();
                          ensureEntry(iso);
                          addNamesToDate(iso, (tempInputs[iso] ?? "").trim());
                        }
                      }}
                    />
                    <button
                      className="rounded-xl border px-3"
                      onClick={() => {
                        ensureEntry(iso);
                        addNamesToDate(iso, (tempInputs[iso] ?? "").trim());
                      }}
                    >
                      추가
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-sm">
                    {(e?.names || []).map((n) => (
                      <span
                        key={n}
                        className="inline-flex items-center gap-1 bg-gray-100 px-2 py-1 rounded-full"
                      >
                        {n}
                        <button
                          className="text-red-600"
                          onClick={() => removeName(iso, n)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 입력된 날짜별 인원 (자동 표 위) */}
      <div className="border rounded-2xl p-3 shadow-sm">
        <div className="text-sm font-medium mb-2">
          입력된 날짜 (총 {entries.length}일)별 인원
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="p-2 text-left">날짜</th>
                <th className="p-2 text-left">이름</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td colSpan={2} className="p-3 text-gray-400">
                    아직 입력 없음
                  </td>
                </tr>
              )}
              {entries.map((e) => (
                <tr key={e.date} className="border-t">
                  <td className="p-2 whitespace-nowrap">
                    {formatDate(e.date, fmt)}
                  </td>
                  <td className="p-2">{e.names.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 자동 생성 표: 동일 날짜세트 + 총일수 기준 rowSpan 병합, 한 줄 표기 */}
      <div className="border rounded-2xl p-3 shadow-sm">
        <div className="text-sm font-bold mb-2">자동 생성 표</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="p-2 text-left">성명</th>
                <th className="p-2 text-left">점검참여일(기간)</th>
              </tr>
            </thead>
            <tbody>
              {byPerson.length === 0 && (
                <tr>
                  <td colSpan={2} className="p-3 text-gray-400">
                    달력에서 날짜를 선택하고 각 날짜에 이름을 추가하면 자동
                    집계됩니다.
                  </td>
                </tr>
              )}

              {Object.values(groupedForRowSpan).map((group) => {
                const first = group[0];
                const rowSpan = group.length;

                const periodInline = `${first.periods} (${first.days}일)`;

                return (
                  <React.Fragment key={`${first.datesKey}-${first.days}`}>
                    <tr className="border-t align-top">
                      <td className="p-2 whitespace-nowrap">{first.name}</td>
                      <td
                        className=" relative p-2 whitespace-nowrap"
                        rowSpan={rowSpan}
                      >
                        <div className="absolute top-[calc(50%-0.5rem)]">
                          {periodInline}
                        </div>
                      </td>
                    </tr>
                    {group.slice(1).map((r) => (
                      <tr
                        key={`${first.datesKey}-${first.days}-${r.name}`}
                        className="border-t align-top"
                      >
                        <td className="p-2 whitespace-nowrap">{r.name}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
