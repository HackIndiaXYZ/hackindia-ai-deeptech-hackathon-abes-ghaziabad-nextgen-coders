import React, { useMemo, useRef, useState } from "react";

/**
 * Smart Visitor Parking Management System (Hackathon MVP)
 * - Frontend-only simulation (no DB required)
 * - Fully interactive: booking, allocation, guard flow, fines, OCR demo
 *
 * Works great for hackathon judges because the whole workflow is demoable live.
 */

export default function App() {
  // ---------- Theme-ish tokens ----------
  const colors = {
    bg: "#0b1220",
    panel: "#0f1b33",
    card: "#132446",
    text: "#e5e7eb",
    muted: "#94a3b8",
    border: "rgba(255,255,255,0.08)",
    green: "#16a34a",
    red: "#dc2626",
    yellow: "#ca8a04",
    blue: "#2563eb",
    purple: "#7c3aed",
  };

  // ---------- Slots (initial layout) ----------
  // Rules:
  // - reserved: true => for residents/admin use (not for visitors unless allowed)
  // - type: "car" | "bike" | "any"
  // - special: "ev" | "disabled" | null
  const initialSlots = useMemo(() => createInitialSlots(), []);
  const [slots, setSlots] = useState(initialSlots);

  // ---------- Bookings / Logs / Fines ----------
  const [bookings, setBookings] = useState([]); // {id, name, phone, vehicleNo, vehicleType, entryTime, exitTime, slotId, status, qrText, createdAt}
  const [logs, setLogs] = useState([]); // {id, vehicleNo, action, at, slotId, bookingId}
  const [fines, setFines] = useState([]); // {id, vehicleNo, amount, reason, at, status, bookingId}

  // ---------- UI state ----------
 const [activeTab, setActiveTab] = useState("home");// dashboard | booking | guard | admin | ai
  const [selectedSlot, setSelectedSlot] = useState(null); // slot object for popup

  // ---------- Booking form ----------
  const [form, setForm] = useState({
    name: "",
    phone: "",
    vehicleNo: "",
    vehicleType: "car", // car | bike
    entryTime: "",
    exitTime: "",
    needEV: false,
    needDisabled: false,
    allowReservedIfFull: false,
  });
  const [bookingResult, setBookingResult] = useState(null);

  // ---------- Wrong parking simulation ----------
  const [wrongParking, setWrongParking] = useState({
    bookingId: "",
    parkedSlotId: "",
    warningSent: false,
  });

  // ---------- Guard flow ----------
  const [guardPlate, setGuardPlate] = useState("");
  const [guardMessage, setGuardMessage] = useState("");

  // ---------- AI OCR demo ----------
  const [ocrImage, setOcrImage] = useState(null);
  const [ocrPreview, setOcrPreview] = useState("");
  const [ocrResult, setOcrResult] = useState(null);
  const fileRef = useRef(null);

  // ---------- Derived stats ----------
  const stats = useMemo(() => {
    const total = slots.length;
    const occupied = slots.filter((s) => s.status === "occupied").length;
    const reserved = slots.filter((s) => s.status === "reserved").length;
    const available = total - occupied - reserved;
    const activeBookings = bookings.filter((b) => b.status === "ACTIVE").length;
    const revenue = fines
      .filter((f) => f.status === "PAID")
      .reduce((sum, f) => sum + f.amount, 0);
    const pendingFines = fines.filter((f) => f.status === "PENDING").length;

    return { total, occupied, reserved, available, activeBookings, revenue, pendingFines };
  }, [slots, bookings, fines]);

  // ---------- Helpers ----------
  function toast(msg) {
    // simple alert for hackathon MVP
    alert(msg);
  }

  function setSlotStatus(slotId, status, meta = {}) {
    setSlots((prev) =>
      prev.map((s) => (s.id === slotId ? { ...s, status, ...meta } : s))
    );
  }

  function findBookingByPlate(vehicleNo) {
    const v = normalizePlate(vehicleNo);
    return bookings.find((b) => normalizePlate(b.vehicleNo) === v && b.status !== "CLOSED");
  }

  // Smart Allocation:
  // 1) pick best matching slot: special EV/Disabled first if needed
  // 2) match vehicle type (car/bike/any)
  // 3) prefer nearest by (zoneOrder, number)
  // 4) avoid reserved unless allowReservedIfFull true
  function allocateSlotSmart(opts) {
    const {
      vehicleType,
      needEV,
      needDisabled,
      allowReservedIfFull,
    } = opts;

    const availableSlots = slots.filter((s) => s.status === "available");
    const reservedSlots = slots.filter((s) => s.status === "reserved");

    const poolPrimary = availableSlots;
    const poolSecondary = allowReservedIfFull ? reservedSlots : [];

    const pool = [...poolPrimary, ...poolSecondary];

    // filter by special requirement
    let filtered = pool.filter((s) => {
      if (needEV) return s.special === "ev";
      if (needDisabled) return s.special === "disabled";
      return true;
    });

    // if special required but none available, fallback (still allow normal slots)
    if (filtered.length === 0) filtered = pool;

    // filter by vehicle type
    const filteredByType = filtered.filter((s) => s.type === "any" || s.type === vehicleType);
    const finalPool = filteredByType.length ? filteredByType : filtered;

    // sort by "nearest" (zoneOrder then numeric)
    finalPool.sort((a, b) => {
      if (a.zoneOrder !== b.zoneOrder) return a.zoneOrder - b.zoneOrder;
      return a.number - b.number;
    });

    return finalPool[0] || null;
  }

  function handleBookNow() {
    setBookingResult(null);

    // basic validation
    if (!form.name.trim()) return toast("Enter visitor name");
    if (!form.phone.trim()) return toast("Enter phone number");
    if (!form.vehicleNo.trim()) return toast("Enter vehicle number");
    if (!form.entryTime) return toast("Select entry time/date");
    if (!form.exitTime) return toast("Select expected exit time/date");

    const entry = new Date(form.entryTime);
    const exit = new Date(form.exitTime);
    if (exit <= entry) return toast("Exit time must be after entry time");

    // allocate slot
    const chosen = allocateSlotSmart({
      vehicleType: form.vehicleType,
      needEV: form.needEV,
      needDisabled: form.needDisabled,
      allowReservedIfFull: form.allowReservedIfFull,
    });

    if (!chosen) {
      setBookingResult({
        ok: false,
        message: "No slot available. Added to waiting queue (demo).",
      });
      return;
    }

    const bookingId = makeId("BK");
    const slotId = chosen.id;

    // create booking
    const booking = {
      id: bookingId,
      name: form.name.trim(),
      phone: form.phone.trim(),
      vehicleNo: form.vehicleNo.trim().toUpperCase(),
      vehicleType: form.vehicleType,
      entryTime: form.entryTime,
      exitTime: form.exitTime,
      slotId,
      status: "ACTIVE", // ACTIVE | CLOSED
      qrText: `PARK|${bookingId}|${slotId}|${normalizePlate(form.vehicleNo)}`,
      createdAt: new Date().toISOString(),
      warningCount: 0,
    };

    setBookings((prev) => [booking, ...prev]);

    // occupy slot
    setSlotStatus(slotId, "occupied", {
      occupiedBy: normalizePlate(booking.vehicleNo),
      bookingId,
    });

    // log
    addLog({
      vehicleNo: booking.vehicleNo,
      action: "BOOKED",
      slotId,
      bookingId,
    });

    setBookingResult({
      ok: true,
      message: `Booking confirmed! Slot allocated: ${slotId}`,
      booking,
    });

    // reset small fields
    // (keep times so demo is easy)
    setForm((prev) => ({
      ...prev,
      vehicleNo: "",
    }));
  }

  function addLog({ vehicleNo, action, slotId, bookingId }) {
    setLogs((prev) => [
      {
        id: makeId("LOG"),
        vehicleNo,
        action,
        slotId,
        bookingId: bookingId || "",
        at: new Date().toISOString(),
      },
      ...prev,
    ]);
  }

  function createFine({ vehicleNo, amount, reason, bookingId }) {
    const fine = {
      id: makeId("FINE"),
      vehicleNo,
      amount,
      reason,
      bookingId: bookingId || "",
      at: new Date().toISOString(),
      status: "PENDING", // PENDING | PAID
    };
    setFines((prev) => [fine, ...prev]);
    addLog({ vehicleNo, action: `FINE ₹${amount}`, slotId: "", bookingId });
    return fine;
  }

  function payFine(fineId) {
    setFines((prev) =>
      prev.map((f) => (f.id === fineId ? { ...f, status: "PAID" } : f))
    );
  }

  function handleSlotClick(slot) {
    setSelectedSlot(slot);
  }

  function closeSlotPopup() {
    setSelectedSlot(null);
  }

  // Wrong parking flow:
  // Step 1: send warning (simulate)
  // Step 2: if not corrected, generate fine
  function sendWrongParkingWarning() {
    const booking = bookings.find((b) => b.id === wrongParking.bookingId);
    if (!booking) return toast("Select a booking first");
    if (!wrongParking.parkedSlotId) return toast("Select where vehicle is actually parked");

    const correctSlot = booking.slotId;
    const parked = wrongParking.parkedSlotId;

    if (correctSlot === parked) {
      setWrongParking((p) => ({ ...p, warningSent: false }));
      return toast("✅ Parked correctly. No action needed.");
    }

    // warning
    setWrongParking((p) => ({ ...p, warningSent: true }));
    addLog({ vehicleNo: booking.vehicleNo, action: "WRONG PARKING WARNING", slotId: parked, bookingId: booking.id });

    toast("⚠ Warning sent: Please move vehicle to correct slot within 10 minutes (demo).");
  }

  function generateWrongParkingFine() {
    const booking = bookings.find((b) => b.id === wrongParking.bookingId);
    if (!booking) return toast("Select a booking first");
    if (!wrongParking.warningSent) return toast("Send warning first (Step 1)");

    const correctSlot = booking.slotId;
    const parked = wrongParking.parkedSlotId;

    if (correctSlot === parked) {
      setWrongParking((p) => ({ ...p, warningSent: false }));
      return toast("Vehicle moved to correct slot ✅ No fine.");
    }

    // Fine rules (demo):
    // after 10 mins: ₹50
    createFine({
      vehicleNo: booking.vehicleNo,
      amount: 50,
      reason: `Wrong parking detected. Assigned: ${correctSlot}, Parked: ${parked}`,
      bookingId: booking.id,
    });

    toast("✅ Fine generated: ₹50 (demo rule).");
  }

  // Guard check-in/out
  function guardCheckIn() {
    if (!guardPlate.trim()) return toast("Enter vehicle number");
    const booking = findBookingByPlate(guardPlate);
    if (!booking) {
      setGuardMessage("❌ No booking found. (In real system: allocate on-arrival)");
      return;
    }
    addLog({ vehicleNo: booking.vehicleNo, action: "CHECK-IN", slotId: booking.slotId, bookingId: booking.id });
    setGuardMessage(`✅ Check-in successful. Slot: ${booking.slotId}`);
  }

  function guardCheckOut() {
    if (!guardPlate.trim()) return toast("Enter vehicle number");
    const booking = findBookingByPlate(guardPlate);
    if (!booking) {
      setGuardMessage("❌ No active booking found.");
      return;
    }

    // compute fees (demo):
    // Base fee: ₹20/hour for car, ₹10/hour for bike
    const entry = new Date(booking.entryTime);
    const now = new Date();
    const hours = Math.max(1, Math.ceil((now - entry) / (1000 * 60 * 60)));

    const rate = booking.vehicleType === "car" ? 20 : 10;
    const parkingFee = hours * rate;

    // overtime if past expected exit: ₹30/hour
    const expectedExit = new Date(booking.exitTime);
    let overtimeFee = 0;
    if (now > expectedExit) {
      const overtimeHours = Math.ceil((now - expectedExit) / (1000 * 60 * 60));
      overtimeFee = overtimeHours * 30;
    }

    // If has pending fines, show total
    const pending = fines
      .filter((f) => f.bookingId === booking.id && f.status === "PENDING")
      .reduce((sum, f) => sum + f.amount, 0);

    const total = parkingFee + overtimeFee + pending;

    // close booking + free slot
    setBookings((prev) =>
      prev.map((b) => (b.id === booking.id ? { ...b, status: "CLOSED", closedAt: now.toISOString() } : b))
    );
    setSlotStatus(booking.slotId, "available", { occupiedBy: "", bookingId: "" });

    addLog({ vehicleNo: booking.vehicleNo, action: `CHECK-OUT (Total ₹${total})`, slotId: booking.slotId, bookingId: booking.id });

    setGuardMessage(
      `✅ Check-out done.\nHours: ${hours}\nParking Fee: ₹${parkingFee}\nOvertime: ₹${overtimeFee}\nPending Fines: ₹${pending}\nTotal: ₹${total}\n(You can simulate payment in Admin tab)`
    );
  }

  // AI OCR demo (simulate)
  function handlePickImage() {
    fileRef.current?.click();
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcrImage(file);
    setOcrResult(null);

    const url = URL.createObjectURL(file);
    setOcrPreview(url);
  }

  function runOcrDemo() {
    if (!ocrImage) return toast("Upload a car/number plate image first");

    // Simulated OCR output (good enough for hackathon demo)
    const samples = ["DL8CAF5030", "UP14BT1234", "WB20AB1234", "HR26DK8337", "MH12DE1433"];
    const text = samples[Math.floor(Math.random() * samples.length)];
    const confidence = (92 + Math.random() * 7).toFixed(1);

    const result = {
      extractedText: text,
      confidence: `${confidence}%`,
      verified: !!findBookingByPlate(text),
      note: "Simulated OCR (replace with EasyOCR/Tesseract in AI module).",
    };
    setOcrResult(result);

    addLog({ vehicleNo: text, action: `OCR SCAN (${confidence}%)`, slotId: "", bookingId: "" });
  }

  // ---------- UI ----------
  return (
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.text, fontFamily: "Arial" }}>
      <TopBar colors={colors} activeTab={activeTab} setActiveTab={setActiveTab} />

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 18px 60px" }}>
        {/* Title + Problem Statement */}


        {/* Tabs */}
        <div style={{ marginTop: 18 }}>

          {activeTab === "home" && (
            <>
              <div
                style={{
                  padding: 30,
                  borderRadius: 24,
                  background:
                    "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(139,92,246,0.12))",
                  border: `1px solid ${colors.border}`,
                  marginBottom: 30,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 48,
                    fontWeight: 800,
                    marginBottom: 12,
                  }}
                >
                  🚗 Smart Visitor Parking
                </div>

                <div
                  style={{
                    fontSize: 22,
                    color: "#cbd5e1",
                    maxWidth: 900,
                    margin: "0 auto",
                    lineHeight: 1.8,
                  }}
                >
                  AI-powered smart parking management system for residential
                  societies with automatic slot allocation, AI number plate
                  detection, security monitoring, fine management, and urgent
                  parking handling.
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    gap: 20,
                    marginTop: 30,
                    flexWrap: "wrap",
                  }}
                >
                  <Button
                    colors={colors}
                    onClick={() => setActiveTab("booking")}
                  >
                    Book Parking
                  </Button>

                  <Button
                    colors={colors}
                    variant="ghost"
                    onClick={() => setActiveTab("ai")}
                  >
                    AI Number Plate Detection
                  </Button>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
                  gap: 20,
                }}
              >
                <div
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: 20,
                    padding: 24,
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  <div style={{ fontSize: 38 }}>🅿</div>
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      marginTop: 12,
                    }}
                  >
                    Smart Slot Allocation
                  </div>

                  <div style={{ marginTop: 10, color: "#cbd5e1" }}>
                    Automatically assigns the best available parking slot
                    based on availability and priority.
                  </div>
                </div>

                <div
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: 20,
                    padding: 24,
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  <div style={{ fontSize: 38 }}>🤖</div>

                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      marginTop: 12,
                    }}
                  >
                    AI Number Plate OCR
                  </div>

                  <div style={{ marginTop: 10, color: "#cbd5e1" }}>
                    AI scans vehicle number plates automatically using OCR
                    detection system.
                  </div>
                </div>

                <div
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: 20,
                    padding: 24,
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  <div style={{ fontSize: 38 }}>🛡</div>

                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      marginTop: 12,
                    }}
                  >
                    Security Guard Dashboard
                  </div>

                  <div style={{ marginTop: 10, color: "#cbd5e1" }}>
                    Guards can quickly check-in/check-out vehicles and
                    monitor parking violations.
                  </div>
                </div>

                <div
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: 20,
                    padding: 24,
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  <div style={{ fontSize: 38 }}>🚨</div>

                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      marginTop: 12,
                    }}
                  >
                    Emergency Parking
                  </div>

                  <div style={{ marginTop: 10, color: "#cbd5e1" }}>
                    Supports urgent parking allocation and automatic fine
                    generation for rule violations.
                  </div>
                </div>
              </div>

              <div
                style={{
                  marginTop: 40,
                  padding: 30,
                  borderRadius: 24,
                  background: "rgba(255,255,255,0.03)",
                  border: `1px solid ${colors.border}`,
                }}
              >
                <div
                  style={{
                    fontSize: 30,
                    fontWeight: 700,
                    marginBottom: 20,
                    textAlign: "center",
                  }}
                >
                  🚀 System Workflow
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                    gap: 18,
                    textAlign: "center",
                  }}
                >
                  {[
                    "Visitor Books Slot",
                    "AI Allocates Slot",
                    "Guard Verifies Entry",
                    "AI OCR Detects Plate",
                    "Parking Monitoring",
                    "Fine Management",
                  ].map((step, index) => (
                    <div
                      key={index}
                      style={{
                        padding: 18,
                        borderRadius: 16,
                        background: "rgba(255,255,255,0.04)",
                        border: `1px solid ${colors.border}`,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 30,
                          fontWeight: 800,
                          marginBottom: 10,
                          color: "#60a5fa",
                        }}
                      >
                        {index + 1}
                      </div>

                      <div style={{ fontWeight: 600 }}>
                        {step}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}


          {activeTab === "dashboard" && (
            <>
              <StatsRow colors={colors} stats={stats} />
              <SectionTitle title="Live Parking Map" subtitle="Click any slot to view details" />

              <SlotLegend colors={colors} />

              <SlotGrid
                colors={colors}
                slots={slots}
                onClickSlot={handleSlotClick}
              />

              <SectionTitle title="Recent Activity (Logs)" subtitle="What happened in the system" />
              <LogsTable colors={colors} logs={logs.slice(0, 8)} />
            </>
          )}

          {activeTab === "booking" && (
            <>
              <SectionTitle
                title="Book Visitor Parking"
                subtitle="Enter visitor details → system allocates best available slot → generates Booking ID + QR"
              />

              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.5fr", gap: 20 }}>
                <Panel colors={colors} title="Booking Form">
                  <div style={{ display: "grid", gridTemplateColumns: "0.5fr 0.5fr", gap: 30 }}>
                    <Input label="Visitor Name" value={form.name} onChange={(v) => setForm((p) => ({ ...p, name: v }))} />
                    <Input label="Phone" value={form.phone} onChange={(v) => setForm((p) => ({ ...p, phone: v }))} />
                    <Input label="Vehicle Number" placeholder="e.g. WB20AB1234" value={form.vehicleNo} onChange={(v) => setForm((p) => ({ ...p, vehicleNo: v.toUpperCase() }))} />
                    <Select
                      label="Vehicle Type"
                      value={form.vehicleType}
                      onChange={(v) => setForm((p) => ({ ...p, vehicleType: v }))}
                      options={[
                        { label: "Car", value: "car" },
                        { label: "Bike", value: "bike" },
                      ]}
                    />
                    <DateTime label="Entry Date & Time" value={form.entryTime} onChange={(v) => setForm((p) => ({ ...p, entryTime: v }))} />
                    <DateTime label="Expected Exit Date & Time" value={form.exitTime} onChange={(v) => setForm((p) => ({ ...p, exitTime: v }))} />
                  </div>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
                    <Checkbox
                      label="Need EV Slot"
                      checked={form.needEV}
                      onChange={(v) => setForm((p) => ({ ...p, needEV: v }))}
                    />
                    <Checkbox
                      label="Need Disabled Slot"
                      checked={form.needDisabled}
                      onChange={(v) => setForm((p) => ({ ...p, needDisabled: v }))}
                    />
                    <Checkbox
                      label="Use Reserved if Full"
                      checked={form.allowReservedIfFull}
                      onChange={(v) => setForm((p) => ({ ...p, allowReservedIfFull: v }))}
                    />
                  </div>

                  <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
                    <Button colors={colors} onClick={handleBookNow}>
                      Book Slot (Smart Allocate)
                    </Button>
                    <Button colors={colors} variant="ghost" onClick={() => setForm({ name: "", phone: "", vehicleNo: "", vehicleType: "car", entryTime: "", exitTime: "", needEV: false, needDisabled: false, allowReservedIfFull: false })}>
                      Reset
                    </Button>
                  </div>

                  {bookingResult && (
                    <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: `1px solid ${colors.border}`, background: bookingResult.ok ? "rgba(22,163,74,0.12)" : "rgba(220,38,38,0.12)" }}>
                      <div style={{ fontWeight: 700 }}>{bookingResult.ok ? "✅ Success" : "❌ Failed"}</div>
                      <div style={{ marginTop: 6, color: "#cbd5e1" }}>{bookingResult.message}</div>

                      {bookingResult.booking && (
                        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          <MiniCard colors={colors} title="Booking ID" value={bookingResult.booking.id} />
                          <MiniCard colors={colors} title="Allocated Slot" value={bookingResult.booking.slotId} />
                          <MiniCard colors={colors} title="QR (demo text)" value={bookingResult.booking.qrText} />
                          <MiniCard colors={colors} title="Status" value={bookingResult.booking.status} />
                        </div>
                      )}
                    </div>
                  )}
                </Panel>


                <Panel colors={colors} title="Active Bookings">
                    <Panel colors={colors} title="Urgent Parking Request">
                  <div
                    style={{
                      background: "rgba(239,68,68,0.08)",
                      border: "1px solid rgba(239,68,68,0.3)",
                      borderRadius: 16,
                      padding: 18,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: "#fca5a5",
                        marginBottom: 8,
                      }}
                    >
                      🚨 Emergency Parking Allocation
                    </div>

                    <div
                      style={{
                        color: "#cbd5e1",
                        lineHeight: 1.7,
                        marginBottom: 16,
                      }}
                    >
                      For ambulance, emergency guests, VIP visitors, delivery vans,
                      or urgent society access.
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 14,
                      }}
                    >
                      <Input
                        label="Vehicle Number"
                        placeholder="e.g. DL01AB1234"
                      />

                      <Select
                        label="Emergency Type"
                        options={[
                          { label: "Ambulance", value: "ambulance" },
                          { label: "Fire Service", value: "fire" },
                          { label: "VIP Guest", value: "vip" },
                          { label: "Emergency Delivery", value: "delivery" },
                        ]}
                      />
                    </div>

                    <div style={{ marginTop: 18 }}>
                        <Button
                          colors={{
                            primary: "#ef4444",
                            secondary: "#dc2626",
                          }}
                          onClick={() => {
                            alert("🚨 Urgent parking slot allocated successfully!");
                          }}
                        >
                          Allocate Priority Slot
                        </Button>
                    </div>

                    <div
                      style={{
                        marginTop: 16,
                        padding: 12,
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.03)",
                        color: "#fca5a5",
                      }}
                    >
                      Smart AI engine reserves nearest available priority slot
                      automatically.
                    </div>
                  </div>
                </Panel>

                </Panel>


                <Panel colors={colors} title="Active Bookings">
                  <BookingsList colors={colors} bookings={bookings} />
                </Panel>
              </div>

              <SectionTitle title="Wrong Parking Detection + Fine (Demo)" subtitle="Select a booking, choose actual parked slot → Warning → Fine" />

              <Panel colors={colors} title="Rule Enforcement">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <Select
                    label="Select Booking"
                    value={wrongParking.bookingId}
                    onChange={(v) => setWrongParking((p) => ({ ...p, bookingId: v, warningSent: false }))}
                    options={[
                      { label: "-- Choose --", value: "" },
                      ...bookings.filter((b) => b.status === "ACTIVE").map((b) => ({
                        label: `${b.id} (${b.vehicleNo}) -> Assigned ${b.slotId}`,
                        value: b.id,
                      })),
                    ]}
                  />

                  <Select
                    label="Vehicle Parked At (Actual)"
                    value={wrongParking.parkedSlotId}
                    onChange={(v) => setWrongParking((p) => ({ ...p, parkedSlotId: v }))}
                    options={[
                      { label: "-- Choose --", value: "" },
                      ...slots.map((s) => ({ label: `${s.id} (${s.status})`, value: s.id })),
                    ]}
                  />

                  <div style={{ alignSelf: "end", display: "flex", gap: 10 }}>
                    <Button colors={colors} onClick={sendWrongParkingWarning}>
                      Step 1: Send Warning
                    </Button>
                    <Button colors={colors} variant="danger" onClick={generateWrongParkingFine}>
                      Step 2: Fine ₹50
                    </Button>
                  </div>
                </div>

                <div style={{ marginTop: 10, color: colors.muted }}>
                  Rule demo: first warning free, after warning → fine ₹50.
                </div>
              </Panel>
            </>
          )}

          {activeTab === "guard" && (
            <>
              <SectionTitle
                title="Security Guard Dashboard"
                subtitle="Quick check-in/check-out using vehicle number"
              />

              <Panel colors={colors} title="Entry / Exit Control">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 0.7fr", gap: 50 }}>
                  <div>
                    <Input
                      label="Vehicle Number"
                      placeholder="e.g. WB20AB1234"
                      value={guardPlate}
                      onChange={(v) => setGuardPlate(v.toUpperCase())}
                    />

                    <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                      <Button colors={colors} onClick={guardCheckIn}>
                        Check-In
                      </Button>
                      <Button colors={colors} variant="ghost" onClick={guardCheckOut}>
                        Check-Out (Bill)
                      </Button>
                    </div>

                    <div style={{ marginTop: 12, whiteSpace: "pre-wrap", color: "#cbd5e1" }}>
                      {guardMessage}
                    </div>
                  </div>

                <div
                style={{
                    background: "rgba(255,255,255,0.03)",
                    padding: 20,
                    borderRadius: 16,
                    border: `1px solid ${colors.border}`,
                    minHeight: 220,
                }}
                >
                <div
                    style={{
                    fontWeight: 700,
                    marginBottom: 14,
                    fontSize: 20,
                    }}
                >
                    Quick Tips
                </div>

                <ul
                    style={{
                    color: "#cbd5e1",
                    lineHeight: 2,
                    paddingLeft: 18,
                    fontSize: 15,
                    }}
                >
                    <li>Enter booked vehicle number</li>
                    <li>Click Check-In for entry</li>
                    <li>Check-Out calculates bill</li>
                    <li>Admin manages fines</li>
                </ul>
                </div>
                </div>
              </Panel>

              <SectionTitle title="Recent Logs" subtitle="Guard actions + system actions" />
              <LogsTable colors={colors} logs={logs.slice(0, 12)} />
            </>
          )}

          {activeTab === "ai" && (
            <>
              <SectionTitle
                title="AI Parking Verification (Demo)"
                subtitle="Upload a car/plate photo"
              />

              <Panel colors={colors} title="Number Plate OCR Demo">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <Button colors={colors} onClick={handlePickImage}>
                        Upload Image
                      </Button>
                      <Button colors={colors} variant="ghost" onClick={runOcrDemo}>
                        Run OCR (Demo)
                      </Button>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                        style={{ display: "none" }}
                      />
                    </div>

                    {ocrPreview && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ color: colors.muted, marginBottom: 6 }}>Preview</div>
                        <img
                          src={ocrPreview}
                          alt="preview"
                          style={{
                            width: "100%",
                            maxHeight: 320,
                            objectFit: "cover",
                            borderRadius: 14,
                            border: `1px solid ${colors.border}`,
                          }}
                        />
                      </div>
                    )}
                  </div>

                  <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${colors.border}`, borderRadius: 14, padding: 12 }}>
                    <div style={{ fontWeight: 700 }}></div>

                    {!ocrResult && (
                      <div style={{ marginTop: 10, color: colors.muted }}>
                        
                      </div>
                    )}

                    {ocrResult && (
                      <div style={{ marginTop: 10, lineHeight: 1.8 }}>
                        <div><b>Extracted Text:</b> {ocrResult.extractedText}</div>
                        <div><b>Confidence:</b> {ocrResult.confidence}</div>
                        <div>
                          <b>Booking Match:</b>{" "}
                          {ocrResult.verified ? (
                            <span style={{ color: colors.green }}>✅ Verified (booking exists)</span>
                          ) : (
                            <span style={{ color: colors.yellow }}>⚠ Not found (allocate on-arrival)</span>
                          )}
                        </div>
                        <div style={{ marginTop: 10, color: colors.muted }}>
                          {ocrResult.note}
                        </div>
                      </div>
                    )}

                  </div>
                </div>
              </Panel>


              <Panel colors={colors} title="Demo Script">
                <ol style={{ color: "#cbd5e1", lineHeight: 1.8, marginTop: 0 }}>
                  <li>Go to Booking tab → create booking → show slot allocation + QR text</li>
                  <li>Go to AI tab → upload photo → show extracted number + confidence + booking match</li>
                  <li>Go to Guard tab → check-in/out → show billing</li>
                  <li>Go to Booking tab → wrong parking → warning + fine</li>
                  <li>Go to Admin tab → show fines + mark PAID</li>
                </ol>
              </Panel>
            </>
          )}

          {activeTab === "admin" && (
            <>
              <SectionTitle
                title="Admin Dashboard"
                subtitle="Occupancy overview, bookings, fines, and logs"
              />

              <StatsRow colors={colors} stats={stats} />

              <div style={{ display: "grid", gridTemplateColumns: "0.4fr 0.5fr", gap: 16 }}>
                <Panel colors={colors} title="Active Bookings">
                  <BookingsList colors={colors} bookings={bookings} />
                </Panel>

                <Panel colors={colors} title="Fine Management">
                  <FinesTable colors={colors} fines={fines} onPay={payFine} />
                </Panel>
              </div>

              <SectionTitle title="System Logs" subtitle="Auditable trail for smart-city style monitoring" />
              <LogsTable colors={colors} logs={logs.slice(0, 20)} />
            </>
          )}
        </div>
      </div>

      {/* Slot popup */}
      {selectedSlot && (
        <Modal onClose={closeSlotPopup}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Slot {selectedSlot.id}</div>
          <div style={{ marginTop: 10, color: "#cbd5e1", lineHeight: 1.8 }}>
            <div><b>Status:</b> {selectedSlot.status}</div>
            <div><b>Type:</b> {selectedSlot.type}</div>
            <div><b>Special:</b> {selectedSlot.special || "-"}</div>
            <div><b>Reserved:</b> {selectedSlot.status === "reserved" ? "Yes" : "No"}</div>
            <div><b>Occupied By:</b> {selectedSlot.occupiedBy || "-"}</div>
            <div><b>Booking ID:</b> {selectedSlot.bookingId || "-"}</div>
          </div>

          <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
            <button onClick={closeSlotPopup} style={modalBtn}>
              Close
            </button>
          </div>
        </Modal>
      )}


    </div>
  );
}

/* ------------------------------ UI Components ------------------------------ */

function TopBar({ colors, activeTab, setActiveTab }) {
  const tabs = [
    { id: "home", label: "Home" },
    { id: "dashboard", label: "Dashboard" },
    { id: "booking", label: "Booking" },
    { id: "guard", label: "Guard" },
    { id: "ai", label: "AI Verification" },
    { id: "admin", label: "Admin" },
  ];

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        background: "rgba(11,18,32,0.92)",
        backdropFilter: "blur(10px)",
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "12px 18px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontWeight: 900, letterSpacing: 0.4 }}>SVPMS</div>
        <div style={{ color: colors.muted, fontSize: 13 }}>
          Smart Visitor Parking
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: `1px solid ${colors.border}`,
                background: activeTab === t.id ? "rgba(255,255,255,0.10)" : "transparent",
                color: "#e5e7eb",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title, subtitle }) {
  return (
    <div style={{ marginTop: 18, marginBottom: 10 }}>
      <div style={{ fontSize: 18, fontWeight: 900 }}>{title}</div>
      {subtitle && <div style={{ marginTop: 4, color: "#94a3b8" }}>{subtitle}</div>}
    </div>
  );
}

function Panel({ colors, title, children }) {
  return (
    <div style={{ background: colors.panel, border: `1px solid ${colors.border}`, borderRadius: 18, padding: 16 }}>
      <div style={{ fontWeight: 900, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function StatsRow({ colors, stats }) {
  const items = [
    { label: "Total Slots", value: stats.total },
    { label: "Available", value: stats.available },
    { label: "Occupied", value: stats.occupied },
    { label: "Reserved", value: stats.reserved },
    { label: "Active Bookings", value: stats.activeBookings },
    { label: "Revenue (Paid Fines)", value: `₹${stats.revenue}` },
    { label: "Pending Fines", value: stats.pendingFines },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginTop: 14 }}>
      {items.map((it) => (
        <div key={it.label} style={{ background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 16, padding: 14 }}>
          <div style={{ color: colors.muted, fontSize: 13 }}>{it.label}</div>
          <div style={{ marginTop: 8, fontSize: 22, fontWeight: 900 }}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

function SlotLegend({ colors }) {
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
      <LegendPill color={colors.green} label="Available" />
      <LegendPill color={colors.red} label="Occupied" />
      <LegendPill color={colors.yellow} label="Reserved" />
      <LegendPill color={colors.purple} label="EV" />
      <LegendPill color={colors.blue} label="Disabled" />
    </div>
  );
}

function LegendPill({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)" }}>
      <span style={{ width: 10, height: 10, borderRadius: 999, background: color, display: "inline-block" }} />
      <span style={{ color: "#cbd5e1", fontSize: 13, fontWeight: 700 }}>{label}</span>
    </div>
  );
}

function SlotGrid({ colors, slots, onClickSlot }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 10 }}>
      {slots.map((s) => {
        const bg =
          s.status === "available" ? colors.green :
          s.status === "occupied" ? colors.red :
          colors.yellow;

        const badgeColor =
          s.special === "ev" ? colors.purple :
          s.special === "disabled" ? colors.blue :
          "";

        return (
          <button
            key={s.id}
            onClick={() => onClickSlot(s)}
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: 14,
              background: bg,
              color: "white",
              padding: "14px 10px",
              cursor: "pointer",
              fontWeight: 900,
              position: "relative",
              minHeight: 56,
            }}
            title={`Slot ${s.id} • ${s.status} • ${s.type}${s.special ? " • " + s.special : ""}`}
          >
            {s.id}
            {s.special && (
              <span style={{
                position: "absolute",
                top: 6,
                right: 6,
                background: badgeColor,
                borderRadius: 999,
                padding: "2px 8px",
                fontSize: 11,
                fontWeight: 900,
                border: "1px solid rgba(255,255,255,0.25)"
              }}>
                {s.special.toUpperCase()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function BookingsList({ colors, bookings }) {
  if (!bookings.length) return <div style={{ color: colors.muted }}>No bookings yet.</div>;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {bookings.slice(0, 8).map((b) => (
        <div key={b.id} style={{ border: `1px solid ${colors.border}`, background: "rgba(255,255,255,0.03)", borderRadius: 14, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontWeight: 900 }}>{b.id}</div>
            <div style={{ color: b.status === "ACTIVE" ? "#86efac" : "#cbd5e1", fontWeight: 800 }}>
              {b.status}
            </div>
          </div>
          <div style={{ marginTop: 6, color: "#cbd5e1", lineHeight: 1.6 }}>
            <div><b>Slot:</b> {b.slotId}</div>
            <div><b>Vehicle:</b> {b.vehicleNo} ({b.vehicleType})</div>
            <div><b>Entry:</b> {new Date(b.entryTime).toLocaleString()}</div>
            <div><b>Exit:</b> {new Date(b.exitTime).toLocaleString()}</div>
          </div>
          <div style={{ marginTop: 8, color: colors.muted, fontSize: 12 }}>
            QR: {b.qrText}
          </div>
        </div>
      ))}
    </div>
  );
}

function FinesTable({ colors, fines, onPay }) {
  if (!fines.length) return <div style={{ color: colors.muted }}>No fines generated.</div>;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: colors.muted, textAlign: "left", fontSize: 13 }}>
            <th style={th}>Fine ID</th>
            <th style={th}>Vehicle</th>
            <th style={th}>Amount</th>
            <th style={th}>Reason</th>
            <th style={th}>Status</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {fines.slice(0, 10).map((f) => (
            <tr key={f.id} style={{ borderTop: `1px solid ${colors.border}` }}>
              <td style={td}>{f.id}</td>
              <td style={td}>{f.vehicleNo}</td>
              <td style={td}>₹{f.amount}</td>
              <td style={{ ...td, maxWidth: 260 }}>{f.reason}</td>
              <td style={td}>
                {f.status === "PAID" ? (
                  <span style={{ color: "#86efac", fontWeight: 900 }}>PAID</span>
                ) : (
                  <span style={{ color: "#fca5a5", fontWeight: 900 }}>PENDING</span>
                )}
              </td>
              <td style={td}>
                {f.status === "PENDING" && (
                  <button onClick={() => onPay(f.id)} style={payBtn}>
                    Mark Paid
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LogsTable({ colors, logs }) {
  if (!logs.length) return <div style={{ color: colors.muted }}>No logs yet.</div>;

  return (
    <div style={{ overflowX: "auto", background: colors.panel, border: `1px solid ${colors.border}`, borderRadius: 18 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: colors.muted, textAlign: "left", fontSize: 13 }}>
            <th style={th}>Time</th>
            <th style={th}>Action</th>
            <th style={th}>Vehicle</th>
            <th style={th}>Slot</th>
            <th style={th}>Booking</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id} style={{ borderTop: `1px solid ${colors.border}` }}>
              <td style={td}>{new Date(l.at).toLocaleString()}</td>
              <td style={td}><b>{l.action}</b></td>
              <td style={td}>{l.vehicleNo}</td>
              <td style={td}>{l.slotId || "-"}</td>
              <td style={td}>{l.bookingId || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ Form bits ------------------------------ */

function Input({ label, value, onChange, placeholder = "" }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 6, fontWeight: 800 }}>{label}</div>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    </div>
  );
}

function DateTime({ label, value, onChange }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 6, fontWeight: 800 }}>{label}</div>
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 6, fontWeight: 800 }}>{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        {options.map((o) => (
          <option key={`${o.value}`} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Checkbox({ label, checked, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ color: "#cbd5e1", fontWeight: 800, fontSize: 13 }}>{label}</span>
    </label>
  );
}

function Button({ colors, children, onClick, variant }) {
  let bg = "rgba(255,255,255,0.10)";
  let border = `1px solid ${colors.border}`;
  let color = "#e5e7eb";

  if (!variant) {
    bg = "linear-gradient(90deg, rgba(37,99,235,1), rgba(124,58,237,1))";
    border = "1px solid rgba(255,255,255,0.15)";
  }
  if (variant === "ghost") {
    bg = "rgba(255,255,255,0.06)";
  }
  if (variant === "danger") {
    bg = "linear-gradient(90deg, rgba(220,38,38,1), rgba(202,138,4,1))";
  }

  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 14px",
        borderRadius: 12,
        border,
        background: bg,
        color,
        cursor: "pointer",
        fontWeight: 900,
      }}
    >
      {children}
    </button>
  );
}

function MiniCard({ colors, title, value }) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, background: "rgba(255,255,255,0.03)", borderRadius: 14, padding: 12 }}>
      <div style={{ color: colors.muted, fontSize: 12, fontWeight: 900 }}>{title}</div>
      <div style={{ marginTop: 6, fontWeight: 900, color: "#e5e7eb", wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}

/* ------------------------------ Modal ------------------------------ */

function Modal({ children, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 100%)",
          background: "#0f1b33",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 18,
          padding: 16,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ------------------------------ Utils ------------------------------ */

function normalizePlate(v) {
  return (v || "").replace(/\s+/g, "").toUpperCase();
}

function makeId(prefix) {
  const n = Math.floor(Math.random() * 900000) + 100000;
  return `${prefix}${n}`;
}

function createInitialSlots() {
  // create zones A-D with numbers
  // Zone order for "nearest": A first, then B, then C, then D
  const zones = [
    { zone: "A", zoneOrder: 1, count: 8 },
    { zone: "B", zoneOrder: 2, count: 8 },
    { zone: "C", zoneOrder: 3, count: 8 },
    { zone: "D", zoneOrder: 4, count: 8 },
  ];

  const slots = [];
  zones.forEach(({ zone, zoneOrder, count }) => {
    for (let i = 1; i <= count; i++) {
      slots.push({
        id: `${zone}${i}`,
        zone,
        zoneOrder,
        number: i,
        type: i <= 2 ? "bike" : "car", // first 2 bike, rest car
        special: null, // "ev" | "disabled"
        status: "available", // available | occupied | reserved
        occupiedBy: "",
        bookingId: "",
      });
    }
  });

  // mark a few reserved slots
  slots.find((s) => s.id === "A8").status = "reserved";
  slots.find((s) => s.id === "B8").status = "reserved";

  // add EV slots
  const ev1 = slots.find((s) => s.id === "C7");
  if (ev1) ev1.special = "ev";
  const ev2 = slots.find((s) => s.id === "C8");
  if (ev2) ev2.special = "ev";

  // add disabled slot
  const dis = slots.find((s) => s.id === "A1");
  if (dis) dis.special = "disabled";

  // pre-occupy a couple slots for realistic demo
  occupyMock(slots, "B3", "DL8CAF5030", "BK111111");
  occupyMock(slots, "D5", "UP14BT1234", "BK222222");

  return slots;
}

function occupyMock(slots, slotId, plate, bookingId) {
  const s = slots.find((x) => x.id === slotId);
  if (!s) return;
  s.status = "occupied";
  s.occupiedBy = plate;
  s.bookingId = bookingId;
}

// styles
const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.04)",
  color: "#e5e7eb",
  outline: "none",
};

const th = { padding: "10px 12px" };
const td = { padding: "10px 12px", color: "#e5e7eb", verticalAlign: "top", fontSize: 13 };

const payBtn = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(34,197,94,0.18)",
  color: "#86efac",
  fontWeight: 900,
  cursor: "pointer",
};

const modalBtn = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.06)",
  color: "#e5e7eb",
  cursor: "pointer",
  fontWeight: 900,
};