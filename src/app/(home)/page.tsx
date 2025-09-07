"use client";
import React, { useMemo, useState } from "react";
import Holidays from "date-holidays";

/** ============ Types ============ */
interface Entry {
  date: string; // ISO 'YYYY-MM-DD'
  names: string[];
}

type DateFormat = "MM/DD" | "YYYY.MM.DD";
type MergeMode = "KEEP" | "RED" | "ALL"; // 공백일 적용 / 토·일·공휴일 제거 / 모든 공백일 제거

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
const isNextDay = (a: string, b: string) => addDays(a, 1) === b;

const formatDate = (iso: string, fmt: DateFormat) => {
  const d = fromISO(iso);
  if (fmt === "MM/DD") return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};

const classNames = (...xs: (string | false | undefined)[]) =>
  xs.filter(Boolean).join(" ");

const uniqueSorted = <T,>(arr: T[]) => Array.from(new Set(arr));

/** ============ Holidays (KR) ============ */
const hdKR = new Holidays("KR");

function isKoreanHolidayISO(iso: string): boolean {
  const d = fromISO(iso);
  return !!hdKR.isHoliday(d);
}
function isRedDay(iso: string): boolean {
  const d = fromISO(iso);
  return d.getDay() === 0 || isKoreanHolidayISO(iso); // 일요일 또는 공휴일
}

/** a 다음날~b 전날이 모두 '토/일/공휴일'이면 true */
function areAllWeekendOrHolidayBetween(aISO: string, bISO: string): boolean {
  let cur = addDays(aISO, 1);
  while (cur < bISO) {
    const d = fromISO(cur);
    const isSat = d.getDay() === 6;
    const isSun = d.getDay() === 0;
    const isHoliday = isKoreanHolidayISO(cur);
    if (!(isSat || isSun || isHoliday)) return false;
    cur = addDays(cur, 1);
  }
  return true;
}

/** ============ Calendar Matrix ============ */
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

/** ============ Segment Builder ============ */
/** 주어진 정렬된 날짜 배열 + 모드 + 포맷 → 세그먼트 문자열 반환 */
function buildFormattedPeriodsFromDates(
  dates: string[],
  mode: MergeMode,
  fmt: DateFormat
): string {
  if (!dates.length) return "";
  // 모드별 세그먼트 생성
  const segments: [string, string][] = [];
  if (mode === "ALL") {
    segments.push([dates[0], dates[dates.length - 1]]);
  } else {
    let start = dates[0];
    let prev = dates[0];
    for (let i = 1; i < dates.length; i++) {
      const cur = dates[i];
      const connect =
        isNextDay(prev, cur) ||
        (mode === "RED" && areAllWeekendOrHolidayBetween(prev, cur));
      if (connect) prev = cur;
      else {
        segments.push([start, prev]);
        start = prev = cur;
      }
    }
    segments.push([start, prev]);
  }
  // 포맷팅
  return segments
    .map(([s, e]) =>
      s === e
        ? formatDate(s, fmt)
        : `${formatDate(s, fmt)}~${formatDate(e, fmt)}`
    )
    .join(", ");
}

/** ============ Aggregation ============ */
/**
 * - mergeMode: 전역 공백일 모드(KEEP/RED/ALL)
 * - days: 실제 선택한 날짜 개수
 * - datesKey: 정렬된 ISO join (rowSpan 병합 기준)
 */
function aggregateByPerson(
  entries: Entry[],
  fmt: DateFormat,
  mergeMode: MergeMode
) {
  // name -> sorted unique ISO dates
  const m = new Map<string, string[]>();
  for (const e of entries) {
    for (const nm of e.names) {
      if (!nm) continue;
      const arr = m.get(nm) ?? [];
      arr.push(e.date);
      m.set(nm, arr);
    }
  }
  for (const [k, arr] of m) {
    arr.sort();
    m.set(k, uniqueSorted(arr));
  }

  type Row = {
    name: string;
    periods: string;
    days: number; // 선택된 날짜 수
    datesKey: string; // sorted ISO joined by ','
  };

  const out: Row[] = [];
  for (const [name, dates] of m) {
    if (dates.length === 0) continue;
    out.push({
      name,
      periods: buildFormattedPeriodsFromDates(dates, mergeMode, fmt),
      days: dates.length,
      datesKey: dates.join(","),
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

  // 날짜 선택(개별 토글)
  const [selectedDates, setSelectedDates] = useState<string[]>([]);

  // 입력 데이터
  const [entries, setEntries] = useState<Entry[]>([]);
  const [tempInputs, setTempInputs] = useState<Record<string, string>>({});

  // 옵션 (전역)
  const [fmt, setFmt] = useState<DateFormat>("YYYY.MM.DD");
  const [mergeMode, setMergeMode] = useState<MergeMode>("KEEP");

  // 개별 표(행) 오버라이드: key=datesKey → MergeMode
  const [rowOverride, setRowOverride] = useState<
    Record<string, MergeMode | "GLOBAL">
  >({});

  // 이름 클릭 하이라이트
  const [highlightPerson, setHighlightPerson] = useState<string | null>(null);

  // 삭제 확인 모달 (날짜 해제)
  const [confirm, setConfirm] = useState<{
    open: boolean;
    date: string | null;
  }>({
    open: false,
    date: null,
  });

  const matrix = useMemo(() => buildCalendarMatrix(year, month), [year, month]);
  const monthLabel = useMemo(() => `${year}.${pad(month + 1)}`, [year, month]);

  // 초기화 확인 모달
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  /** 사람 → 날짜세트 맵 (하이라이트 & 인원 목록용) */
  const personDatesMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of entries) {
      for (const n of e.names) {
        if (!map.has(n)) map.set(n, new Set());
        map.get(n)!.add(e.date);
      }
    }
    return map; // name -> Set<ISO>
  }, [entries]);

  const allPeople = useMemo(
    () =>
      Array.from(personDatesMap.keys()).sort((a, b) =>
        a.localeCompare(b, "ko")
      ),
    [personDatesMap]
  );

  function toggleDate(iso: string) {
    const isSelected = selectedDates.includes(iso);
    if (isSelected) {
      const e = entries.find((x) => x.date === iso);
      const hasData = !!e && e.names.length > 0;
      if (hasData) {
        setConfirm({ open: true, date: iso });
        return;
      }
      // 데이터 없으면 바로 해제
      setSelectedDates((prev) => prev.filter((d) => d !== iso));
      setTempInputs((p) => {
        const { [iso]: _, ...rest } = p;
        return rest;
      });
      return;
    }
    // 새로 선택
    setSelectedDates((prev) => [...prev, iso].sort());
  }

  function confirmDeleteDate() {
    if (!confirm.date) return;
    const date = confirm.date;
    setSelectedDates((prev) => prev.filter((d) => d !== date));
    setEntries((prev) => prev.filter((e) => e.date !== date));
    setTempInputs((p) => {
      const { [date]: _, ...rest } = p;
      return rest;
    });
    setConfirm({ open: false, date: null });
  }
  function cancelDeleteDate() {
    setConfirm({ open: false, date: null });
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

  // 집계 (전역 옵션 적용)
  const byPerson = useMemo(
    () => aggregateByPerson(entries, fmt, mergeMode),
    [entries, fmt, mergeMode]
  );

  /** 동일 날짜세트 + days 기준 rowSpan 병합 */
  const groupedForRowSpan = useMemo(() => {
    const groups: Record<
      string,
      { name: string; periods: string; days: number; datesKey: string }[]
    > = {};
    for (const r of byPerson) {
      const key = `${r.datesKey}|${r.days}`;
      (groups[key] ??= []).push(r);
    }
    for (const k of Object.keys(groups)) {
      groups[k].sort((a, b) => a.name.localeCompare(b.name, "ko"));
    }
    return groups;
  }, [byPerson]);

  /** 하이라이트 날짜 집합 */
  const highlightedDates = useMemo(() => {
    if (!highlightPerson) return new Set<string>();
    const set = personDatesMap.get(highlightPerson);
    return set ? new Set(set) : new Set<string>();
  }, [highlightPerson, personDatesMap]);

  return (
    <div className="mx-auto max-w-6xl p-4 space-y-6">
      <h1 className="text-2xl font-bold">점검 참여자 집계 도구</h1>
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
              const isSundayOrHoliday = isRedDay(iso);
              const isSaturday = d.getDay() === 6;
              const isHL = highlightedDates.has(iso);

              return (
                <button
                  key={iso}
                  onClick={() => toggleDate(iso)}
                  className={classNames(
                    "border-gray-600 relative h-16 border flex flex-col items-center justify-start p-1 hover:bg-blue-200",
                    isHL
                      ? " bg-blue-400/80 border-1 border-blue-400"
                      : !isCurrentMonth && "bg-gray-50 text-gray-400",

                    selected &&
                      " ring-1 ring-blue-700 border-1 border-blue-600 bg-blue-100 z-10",
                    hasNames && !selected && "bg-blue-100",
                    isHL && !selected && "bg-blue-300"
                  )}
                  title={iso}
                >
                  <div
                    className={classNames(
                      "text-xs",
                      isSundayOrHoliday && "text-red-600 font-semibold",
                      !isSundayOrHoliday &&
                        isSaturday &&
                        "text-blue-600 font-semibold"
                    )}
                  >
                    {d.getDate()}
                  </div>
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
          {/* 날짜 표기 형식 */}
          <div>
            <div className="text-sm font-medium mb-1">날짜 표기 형식</div>
            <div className="flex gap-3">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="fmt"
                  checked={fmt === "YYYY.MM.DD"}
                  onChange={() => setFmt("YYYY.MM.DD")}
                />
                <span>00.00.00</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="fmt"
                  checked={fmt === "MM/DD"}
                  onChange={() => setFmt("MM/DD")}
                />
                <span>00/00</span>
              </label>
            </div>
          </div>

          {/* 공백일 모드 (전역) */}
          <div>
            <div className="text-sm font-medium mb-1">공백일</div>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="gap-mode"
                  checked={mergeMode === "KEEP"}
                  onChange={() => setMergeMode("KEEP")}
                />
                <span>공백일 적용</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="gap-mode"
                  checked={mergeMode === "RED"}
                  onChange={() => setMergeMode("RED")}
                />
                <span>토·일/공휴일 제거</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="gap-mode"
                  checked={mergeMode === "ALL"}
                  onChange={() => setMergeMode("ALL")}
                />
                <span>모든 공백일 제거</span>
              </label>
            </div>
          </div>

          {/* 전체 초기화 */}
          <button
            className="w-full rounded-xl border py-2 hover:bg-gray-50"
            onClick={() => setShowResetConfirm(true)}
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
                        className={classNames(
                          "inline-flex items-center gap-1 px-2 py-1 rounded-full",
                          highlightPerson === n
                            ? "bg-yellow-100 ring-yellow-400 ring-1"
                            : "bg-gray-100"
                        )}
                      >
                        <button
                          className="hover:underline"
                          onClick={() =>
                            setHighlightPerson((cur) => (cur === n ? null : n))
                          }
                          title="이 인원이 참여하는 날짜를 달력에서 강조"
                        >
                          {n}
                        </button>
                        <button
                          className="text-red-600"
                          onClick={() => removeName(iso, n)}
                          title="이 날짜에서 이름 제거"
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
      {/* ✅ 점검 참여인원 (이름 클릭 시 달력 강조) */}
      <div className="border rounded-2xl p-3 shadow-sm">
        <div className="text-sm font-medium mb-2">점검 참여인원</div>
        {allPeople.length === 0 ? (
          <div className="text-gray-400 text-sm">아직 인원 없음</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {allPeople.map((p) => {
              const cnt = personDatesMap.get(p)?.size ?? 0;
              const active = highlightPerson === p;
              return (
                <button
                  key={p}
                  className={classNames(
                    "text-sm rounded-full px-3 py-1 border",
                    active
                      ? "bg-yellow-100 border-yellow-400 "
                      : "bg-white hover:bg-gray-50"
                  )}
                  onClick={() =>
                    setHighlightPerson((cur) => (cur === p ? null : p))
                  }
                  title="클릭하면 달력에 이 인원의 참여 날짜를 강조합니다"
                >
                  {p} <span className="text-gray-500">({cnt})</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {/* 입력된 날짜 (총 X일)별 인원 */}
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
      {/* 자동 생성 표: 동일 날짜세트 + days 기준 rowSpan 병합 (개별 공백일 오버라이드 지원) */}
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
              {Object.values(groupedForRowSpan).length === 0 && (
                <tr>
                  <td colSpan={2} className="p-3 text-gray-400">
                    달력에서 날짜를 선택하고 각 날짜에 이름을 추가하면 자동
                    집계됩니다.
                  </td>
                </tr>
              )}

              {Object.entries(groupedForRowSpan).map(([groupKey, group]) => {
                const first = group[0];
                const rowSpan = group.length;

                // groupKey는 `${datesKey}|${days}`. datesKey만 추출
                const datesKey = first.datesKey;
                const datesArray = datesKey ? datesKey.split(",") : [];
                const override = rowOverride[datesKey];

                // 표시 모드 결정: 개별 설정이 있으면 우선 적용, 없으면 전역
                const effectiveMode: MergeMode =
                  override && override !== "GLOBAL"
                    ? (override as MergeMode)
                    : mergeMode;

                // periods 재계산 (개별 모드 우선)
                const computedPeriods = buildFormattedPeriodsFromDates(
                  datesArray,
                  effectiveMode,
                  fmt
                );

                // 표시 문자열: "기간 (days일)"
                const periodInline = `${computedPeriods} (${first.days}일)`;

                // <td
                //   className=" relative h-full whitespace-nowrap"
                //   rowSpan={rowSpan}
                // >
                //   {" "}
                //   <div className="absolute h-full p-2 flex items-center">
                //     {" "}
                //     {periodInline}{" "}
                //   </div>{" "}
                // </td>;

                return (
                  <React.Fragment key={groupKey}>
                    <tr className="border-t align-top w-full ">
                      <td className=" p-2 whitespace-nowrap h-full">
                        <div className="flex justify-between items-center gap-1 w-full h-full">
                          {first.name}
                        </div>
                      </td>

                      <td
                        className="h-full p-2 whitespace-nowrap w-full align-middle"
                        rowSpan={rowSpan}
                      >
                        <div className="relative flex items-center justify-between gap-1 w-full h-full">
                          <div>{periodInline}</div>

                          {/* 개별 공백일 선택 (오버라이드) */}
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-gray-500">개별 공백일:</span>
                            <select
                              className="border rounded-md px-2 py-1"
                              value={override ?? "GLOBAL"}
                              onChange={(e) => {
                                const val = e.target.value as
                                  | MergeMode
                                  | "GLOBAL";
                                setRowOverride((prev) => ({
                                  ...prev,
                                  [datesKey]: val,
                                }));
                              }}
                            >
                              <option value="GLOBAL">전역 설정 사용</option>
                              <option value="KEEP">공백일 적용</option>
                              <option value="RED">토·일/공휴일 제거</option>
                              <option value="ALL">모든 공백일 제거</option>
                            </select>
                          </div>
                        </div>
                      </td>
                    </tr>

                    {group.slice(1).map((r) => (
                      <tr
                        key={`${groupKey}-${r.name}`}
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
      {/* 날짜 해제 확인 모달 */}
      {confirm.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) cancelDeleteDate();
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="text-lg font-semibold mb-2">날짜 선택 해제</div>
            <div className="text-sm text-gray-600 mb-4">
              이 날짜의 입력된 이름 데이터도 함께{" "}
              <span className="font-semibold text-red-600">삭제</span>됩니다.
              정말로 해제하고 삭제할까요?
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-xl border hover:bg-gray-50"
                onClick={cancelDeleteDate}
              >
                취소
              </button>
              <button
                className="px-4 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700"
                onClick={confirmDeleteDate}
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
      {showResetConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowResetConfirm(false);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="text-lg font-semibold mb-2">전체 초기화</div>
            <div className="text-sm text-gray-600 mb-4">
              선택한 날짜, 입력된 이름, 개별 공백일 설정 등{" "}
              <b>모든 데이터가 삭제</b>됩니다. 정말로 초기화할까요?
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                className="px-4 py-2 rounded-xl border hover:bg-gray-50"
                onClick={() => setShowResetConfirm(false)}
              >
                취소
              </button>
              <button
                className="px-4 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700"
                onClick={() => {
                  setEntries([]);
                  setSelectedDates([]);
                  setTempInputs({});
                  setHighlightPerson(null);
                  setRowOverride({});
                  setShowResetConfirm(false);
                }}
              >
                초기화
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
