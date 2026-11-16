// SPDX-License-Identifier: AGPL-3.0-or-later
// Minimal host for Google's unmodified Widevine CDM through the Chromium CDM interface (11, else 10).
// Single-threaded by design: the CDM is only ever called from the thread that owns the wv_host, and
// timers, deferred host replies and promise waits are all pumped on that thread. Persistent state is
// off (no file storage), there is no platform verification on Linux, and output protection is
// reported as unknown with no HDCP, which is what a desktop browser reports.
#include "host.h"

#include <dlfcn.h>

#include <algorithm>
#include <chrono>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <functional>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "cdm/content_decryption_module.h"

namespace {

using Clock = std::chrono::steady_clock;
using std::chrono::milliseconds;

class BufferPool;

// CDM output buffer. Picture-sized buffers are recycled through a small pool instead of being
// allocated, zero-filled and freed for every frame; a buffer is zeroed when it leaves the pool for
// good, so clear media never lingers in freed heap memory.
class HeapBuffer final : public cdm::Buffer {
public:
    HeapBuffer(uint32_t capacity, BufferPool* pool) : bytes_(new uint8_t[capacity]), capacity_(capacity), pool_(pool) {}
    void Destroy() override;
    uint32_t Capacity() const override { return capacity_; }
    uint8_t* Data() override { return bytes_; }
    void SetSize(uint32_t size) override { size_ = size; }
    uint32_t Size() const override { return size_; }
    void Free() {
        std::fill(bytes_, bytes_ + capacity_, 0);
        delete this;
    }

private:
    ~HeapBuffer() override { delete[] bytes_; }
    uint8_t* bytes_;
    uint32_t capacity_;
    uint32_t size_ = 0;
    BufferPool* pool_;
};

class BufferPool {
public:
    // Only picture-sized buffers are worth keeping; small (audio) blocks are allocated directly.
    static constexpr uint32_t kMinPooled = 256 * 1024;
    static constexpr size_t kMaxFree = 8;

    HeapBuffer* Take(uint32_t capacity) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (capacity >= kMinPooled) {
            for (size_t i = 0; i < free_.size(); i++) {
                const uint32_t have = free_[i]->Capacity();
                if (have >= capacity && have - capacity <= capacity / 4) {
                    HeapBuffer* b = free_[i];
                    free_.erase(free_.begin() + static_cast<long>(i));
                    b->SetSize(0);
                    return b;
                }
            }
        }
        return new HeapBuffer(capacity, this);
    }
    void Give(HeapBuffer* b) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (b->Capacity() < kMinPooled || free_.size() >= kMaxFree) {
            b->Free();
            return;
        }
        free_.push_back(b);
    }
    ~BufferPool() {
        for (HeapBuffer* b : free_) b->Free();
    }

private:
    std::mutex mutex_;  // the CDM may release buffers from its own decoder threads
    std::vector<HeapBuffer*> free_;
};

void HeapBuffer::Destroy() { pool_->Give(this); }

class Block final : public cdm::DecryptedBlock {
public:
    ~Block() override {
        if (buffer_) buffer_->Destroy();
    }
    void SetDecryptedBuffer(cdm::Buffer* buffer) override {
        if (buffer_ && buffer_ != buffer) buffer_->Destroy();
        buffer_ = buffer;
    }
    cdm::Buffer* DecryptedBuffer() override { return buffer_; }
    void SetTimestamp(int64_t timestamp) override { timestamp_ = timestamp; }
    int64_t Timestamp() const override { return timestamp_; }

private:
    cdm::Buffer* buffer_ = nullptr;
    int64_t timestamp_ = 0;
};

class Frame final : public cdm::VideoFrame {
public:
    ~Frame() override {
        if (buffer_) buffer_->Destroy();
    }
    void SetFormat(cdm::VideoFormat format) override { format_ = format; }
    cdm::VideoFormat Format() const override { return format_; }
    void SetSize(cdm::Size size) override { size_ = size; }
    cdm::Size Size() const override { return size_; }
    void SetFrameBuffer(cdm::Buffer* buffer) override {
        if (buffer_ && buffer_ != buffer) buffer_->Destroy();
        buffer_ = buffer;
    }
    cdm::Buffer* FrameBuffer() override { return buffer_; }
    void SetPlaneOffset(cdm::VideoPlane plane, uint32_t offset) override {
        if (plane < cdm::kMaxPlanes) offset_[plane] = offset;
    }
    uint32_t PlaneOffset(cdm::VideoPlane plane) override { return plane < cdm::kMaxPlanes ? offset_[plane] : 0; }
    void SetStride(cdm::VideoPlane plane, uint32_t stride) override {
        if (plane < cdm::kMaxPlanes) stride_[plane] = stride;
    }
    uint32_t Stride(cdm::VideoPlane plane) override { return plane < cdm::kMaxPlanes ? stride_[plane] : 0; }
    void SetTimestamp(int64_t timestamp) override { timestamp_ = timestamp; }
    int64_t Timestamp() const override { return timestamp_; }

private:
    cdm::VideoFormat format_ = cdm::kUnknownVideoFormat;
    cdm::Size size_{0, 0};
    cdm::Buffer* buffer_ = nullptr;
    uint32_t offset_[3] = {0, 0, 0};
    uint32_t stride_[3] = {0, 0, 0};
    int64_t timestamp_ = 0;
};

// The calls we make have identical signatures in CDM 10 and 11.
struct Cdm {
    virtual ~Cdm() = default;
    virtual void Initialize() = 0;
    virtual void SetServerCertificate(uint32_t promise, const uint8_t* data, uint32_t size) = 0;
    virtual void CreateSession(uint32_t promise, const uint8_t* data, uint32_t size) = 0;
    virtual void Update(uint32_t promise, const std::string& session, const uint8_t* data, uint32_t size) = 0;
    virtual void Close(uint32_t promise, const std::string& session) = 0;
    virtual void TimerExpired(void* context) = 0;
    virtual cdm::Status Decrypt(const cdm::InputBuffer_2& in, cdm::DecryptedBlock* out) = 0;
    virtual void OutputProtection(cdm::QueryResult result, uint32_t links, uint32_t protection) = 0;
    virtual void PlatformChallenge(const cdm::PlatformChallengeResponse& response) = 0;
    virtual void StorageId(uint32_t version) = 0;
    virtual cdm::Status InitVideo(const cdm::VideoDecoderConfig_2& config) = 0;
    virtual cdm::Status DecodeVideo(const cdm::InputBuffer_2& in, cdm::VideoFrame* out) = 0;
    virtual void ResetVideo() = 0;
    virtual void Destroy() = 0;
};

template <class C> struct CdmT final : Cdm {
    explicit CdmT(C* cdm) : c(cdm) {}
    C* c;
    void Initialize() override { c->Initialize(false, false, false); }
    void SetServerCertificate(uint32_t p, const uint8_t* d, uint32_t n) override { c->SetServerCertificate(p, d, n); }
    void CreateSession(uint32_t p, const uint8_t* d, uint32_t n) override {
        c->CreateSessionAndGenerateRequest(p, cdm::kTemporary, cdm::kCenc, d, n);
    }
    void Update(uint32_t p, const std::string& s, const uint8_t* d, uint32_t n) override {
        c->UpdateSession(p, s.data(), static_cast<uint32_t>(s.size()), d, n);
    }
    void Close(uint32_t p, const std::string& s) override { c->CloseSession(p, s.data(), static_cast<uint32_t>(s.size())); }
    void TimerExpired(void* context) override { c->TimerExpired(context); }
    cdm::Status Decrypt(const cdm::InputBuffer_2& in, cdm::DecryptedBlock* out) override { return c->Decrypt(in, out); }
    void OutputProtection(cdm::QueryResult r, uint32_t l, uint32_t p) override { c->OnQueryOutputProtectionStatus(r, l, p); }
    void PlatformChallenge(const cdm::PlatformChallengeResponse& r) override { c->OnPlatformChallengeResponse(r); }
    void StorageId(uint32_t v) override { c->OnStorageId(v, nullptr, 0); }
    cdm::Status InitVideo(const cdm::VideoDecoderConfig_2& config) override { return c->InitializeVideoDecoder(config); }
    cdm::Status DecodeVideo(const cdm::InputBuffer_2& in, cdm::VideoFrame* out) override {
        return c->DecryptAndDecodeFrame(in, out);
    }
    void ResetVideo() override { c->ResetDecoder(cdm::kStreamTypeVideo); }
    void Destroy() override {
        c->Destroy();
        c = nullptr;
    }
};

struct Promise {
    bool done = false;
    bool ok = false;
    std::string session;
    std::string error;
};

class Host final : public cdm::Host_10, public cdm::Host_11 {
public:
    // First member: destroyed last, after the CDM has returned every buffer it was handed.
    BufferPool pool;
    wv_callbacks cb{};
    Cdm* cdm = nullptr;
    bool initialized = false;
    bool init_ok = false;
    bool video_deferred_done = false;
    cdm::Status video_deferred_status = cdm::kSuccess;
    uint32_t next_promise = 1;
    std::map<uint32_t, Promise> promises;

    void log(const char* fmt, ...) {
        if (!cb.on_log) return;
        char line[512];
        va_list args;
        va_start(args, fmt);
        vsnprintf(line, sizeof line, fmt, args);
        va_end(args);
        cb.on_log(cb.user, line);
    }

    // Fires due timers and deferred replies; always at top level, never from inside a CDM call.
    bool tick() {
        run_deferred();
        const auto now = Clock::now();
        bool fired = false;
        for (size_t i = 0; i < timers_.size();) {
            if (timers_[i].due <= now) {
                void* context = timers_[i].context;
                timers_.erase(timers_.begin() + static_cast<long>(i));
                cdm->TimerExpired(context);
                fired = true;
            } else {
                ++i;
            }
        }
        run_deferred();
        return fired;
    }

    bool pump(const std::function<bool()>& done, int timeout_ms) {
        const auto deadline = Clock::now() + milliseconds(timeout_ms);
        for (;;) {
            run_deferred();
            if (done()) return true;
            if (Clock::now() > deadline) return false;
            if (!tick()) std::this_thread::sleep_for(milliseconds(2));
        }
    }

    void run_deferred() {
        while (!deferred_.empty()) {
            auto task = std::move(deferred_.front());
            deferred_.erase(deferred_.begin());
            task();
        }
    }

    cdm::Buffer* Allocate(uint32_t capacity) override { return pool.Take(capacity); }
    void SetTimer(int64_t delay_ms, void* context) override {
        timers_.push_back({Clock::now() + milliseconds(delay_ms), context});
    }
    cdm::Time GetCurrentWallTime() override {
        return std::chrono::duration<double>(std::chrono::system_clock::now().time_since_epoch()).count();
    }
    void OnInitialized(bool success) override {
        initialized = true;
        init_ok = success;
    }
    void OnResolveKeyStatusPromise(uint32_t id, cdm::KeyStatus) override { resolve(id, {}); }
    void OnResolveNewSessionPromise(uint32_t id, const char* session, uint32_t size) override {
        resolve(id, std::string(session, size));
    }
    void OnResolvePromise(uint32_t id) override { resolve(id, {}); }
    void OnRejectPromise(uint32_t id, cdm::Exception exception, uint32_t system_code, const char* message,
        uint32_t size) override {
        Promise& p = promises[id];
        p.done = true;
        p.ok = false;
        p.error = std::string(message ? message : "", size) + " (exception " + std::to_string(exception) +
                  ", system code " + std::to_string(system_code) + ")";
    }
    void OnSessionMessage(const char* session, uint32_t session_size, cdm::MessageType type, const char* message,
        uint32_t size) override {
        if (cb.on_message)
            cb.on_message(cb.user, session, session_size, type, reinterpret_cast<const uint8_t*>(message), size);
    }
    void OnSessionKeysChange(const char*, uint32_t, bool, const cdm::KeyInformation* keys, uint32_t count) override {
        for (uint32_t i = 0; i < count; i++)
            if (cb.on_key_status) cb.on_key_status(cb.user, keys[i].key_id, keys[i].key_id_size, keys[i].status);
    }
    void OnExpirationChange(const char*, uint32_t, cdm::Time) override {}
    void OnSessionClosed(const char*, uint32_t) override {}
    void SendPlatformChallenge(const char*, uint32_t, const char*, uint32_t) override {
        log("platform challenge requested; Linux has no platform verification");
        defer([this] {
            cdm::PlatformChallengeResponse empty{};
            cdm->PlatformChallenge(empty);
        });
    }
    void EnableOutputProtection(uint32_t) override {}
    void QueryOutputProtectionStatus() override {
        // A desktop has no way to vouch for its display link: report it as unknown, without HDCP.
        defer([this] { cdm->OutputProtection(cdm::kQuerySucceeded, cdm::kLinkTypeNone, cdm::kProtectionNone); });
    }
    void OnDeferredInitializationDone(cdm::StreamType type, cdm::Status status) override {
        if (type != cdm::kStreamTypeVideo) return;
        video_deferred_done = true;
        video_deferred_status = status;
    }
    cdm::FileIO* CreateFileIO(cdm::FileIOClient*) override {
        log("CDM asked for file storage; none (persistent state is off)");
        return nullptr;
    }
    void RequestStorageId(uint32_t version) override {
        defer([this, version] { cdm->StorageId(version); });
    }
    void ReportMetrics(cdm::MetricName, uint64_t) override {}

private:
    struct Timer {
        Clock::time_point due;
        void* context;
    };
    std::vector<Timer> timers_;
    std::vector<std::function<void()>> deferred_;

    void defer(std::function<void()> task) { deferred_.push_back(std::move(task)); }
    void resolve(uint32_t id, std::string session) {
        Promise& p = promises[id];
        p.done = true;
        p.ok = true;
        p.session = std::move(session);
    }
};

void* get_host(int version, void* user) {
    auto* host = static_cast<Host*>(user);
    if (version == cdm::Host_11::kVersion) return static_cast<cdm::Host_11*>(host);
    if (version == cdm::Host_10::kVersion) return static_cast<cdm::Host_10*>(host);
    return nullptr;
}

using CreateFn = void* (*)(int, const char*, uint32_t, GetCdmHostFunc, void*);

struct Module {
    std::mutex mutex;
    std::string path;
    std::string version;
    CreateFn create = nullptr;
};

Module& module() {
    static Module m;
    return m;
}

} // namespace

struct wv_host {
    Host host;
    int interface = 0;
};

namespace {

int wait_promise(wv_host* h, uint32_t id, Promise* out) {
    if (!h->host.pump([&] { return h->host.promises[id].done; }, 15000)) {
        h->host.log("promise %u timed out", id);
        return -1;
    }
    *out = h->host.promises[id];
    h->host.promises.erase(id);
    if (!out->ok) {
        h->host.log("promise %u rejected: %s", id, out->error.c_str());
        return -2;
    }
    return 0;
}

uint32_t new_promise(wv_host* h) {
    uint32_t id = h->host.next_promise++;
    h->host.promises[id] = Promise{};
    return id;
}

} // namespace

extern "C" int wv_module_load(const char* cdm_path, char* err, size_t err_len) {
    auto fail = [&](const char* what) {
        if (err && err_len) snprintf(err, err_len, "%s", what);
        return -1;
    };
    Module& m = module();
    std::lock_guard<std::mutex> lock(m.mutex);
    if (m.create) return m.path == cdm_path ? 0 : fail("another Widevine module is already loaded; restart izumi");
    // Never unloaded: the module's own threads may outlive a destroyed instance.
    void* library = dlopen(cdm_path, RTLD_NOW | RTLD_LOCAL);
    if (!library) return fail(dlerror());
    using InitFn = void (*)();
    using VersionFn = const char* (*)();
    auto init = reinterpret_cast<InitFn>(dlsym(library, "InitializeCdmModule_4"));
    auto create = reinterpret_cast<CreateFn>(dlsym(library, "CreateCdmInstance"));
    auto version = reinterpret_cast<VersionFn>(dlsym(library, "GetCdmVersion"));
    if (!init || !create) {
        dlclose(library);
        return fail("not a CDM library (missing InitializeCdmModule_4/CreateCdmInstance)");
    }
    init();
    m.path = cdm_path;
    m.version = version ? version() : "unknown";
    m.create = create;
    return 0;
}

extern "C" const char* wv_module_version(void) { return module().version.c_str(); }

extern "C" wv_host* wv_host_open(int preferred_interface, const wv_callbacks* callbacks, char* err, size_t err_len) {
    auto fail = [&](const char* what) -> wv_host* {
        if (err && err_len) snprintf(err, err_len, "%s", what);
        return nullptr;
    };
    CreateFn create = module().create;
    if (!create) return fail("Widevine module not loaded");
    auto* h = new wv_host;
    if (callbacks) h->host.cb = *callbacks;
    static const char key_system[] = "com.widevine.alpha";
    for (int v : {11, 10}) {
        if (preferred_interface && v != preferred_interface) continue;
        void* instance = create(v, key_system, sizeof key_system - 1, get_host, &h->host);
        if (!instance) continue;
        if (v == 11)
            h->host.cdm = new CdmT<cdm::ContentDecryptionModule_11>(static_cast<cdm::ContentDecryptionModule_11*>(instance));
        else
            h->host.cdm = new CdmT<cdm::ContentDecryptionModule_10>(static_cast<cdm::ContentDecryptionModule_10*>(instance));
        h->interface = v;
        break;
    }
    if (!h->host.cdm) {
        delete h;
        return fail("the Widevine module refused CDM interfaces 11 and 10");
    }
    h->host.cdm->Initialize();
    if (!h->host.pump([&] { return h->host.initialized; }, 15000) || !h->host.init_ok) {
        wv_host_close(h);
        return fail("Widevine module initialisation failed");
    }
    return h;
}

extern "C" int wv_host_interface(const wv_host* h) { return h->interface; }

extern "C" void wv_host_tick(wv_host* h) { h->host.tick(); }

extern "C" int wv_set_server_certificate(wv_host* h, const uint8_t* certificate, uint32_t len) {
    uint32_t id = new_promise(h);
    h->host.cdm->SetServerCertificate(id, certificate, len);
    Promise p;
    return wait_promise(h, id, &p);
}

extern "C" int wv_session_create(wv_host* h, const uint8_t* init_data, uint32_t init_len, char* session_id,
    uint32_t cap) {
    uint32_t id = new_promise(h);
    h->host.cdm->CreateSession(id, init_data, init_len);
    Promise p;
    int rc = wait_promise(h, id, &p);
    if (rc) return rc;
    if (p.session.size() + 1 > cap) return -3;
    memcpy(session_id, p.session.c_str(), p.session.size() + 1);
    return 0;
}

extern "C" int wv_session_update(wv_host* h, const char* session_id, const uint8_t* response, uint32_t len) {
    uint32_t id = new_promise(h);
    h->host.cdm->Update(id, session_id, response, len);
    Promise p;
    return wait_promise(h, id, &p);
}

extern "C" int wv_session_close(wv_host* h, const char* session_id) {
    uint32_t id = new_promise(h);
    h->host.cdm->Close(id, session_id);
    Promise p;
    return wait_promise(h, id, &p);
}

namespace {

// Fills `in` for one CENC sample. An 8-byte IV is the high half of the AES-CTR counter block.
bool cenc_input(cdm::InputBuffer_2& in, uint8_t (&iv16)[16], std::vector<cdm::SubsampleEntry>& entries,
    const uint8_t* key_id, uint32_t key_id_len, const uint8_t* iv, uint32_t iv_len, const uint32_t* subsamples,
    uint32_t pairs, const uint8_t* data, uint32_t len) {
    if (iv_len != 8 && iv_len != 16) return false;
    memset(iv16, 0, sizeof iv16);
    memcpy(iv16, iv, iv_len);
    entries.resize(pairs);
    for (uint32_t i = 0; i < pairs; i++) entries[i] = {subsamples[2 * i], subsamples[2 * i + 1]};
    in.data = data;
    in.data_size = len;
    in.encryption_scheme = cdm::EncryptionScheme::kCenc;
    in.key_id = key_id;
    in.key_id_size = key_id_len;
    in.iv = iv16;
    in.iv_size = sizeof iv16;
    in.subsamples = pairs ? entries.data() : nullptr;
    in.num_subsamples = pairs;
    in.pattern = {0, 0};
    return true;
}

} // namespace

extern "C" int wv_decrypt(wv_host* h, const uint8_t* key_id, uint32_t key_id_len, const uint8_t* iv, uint32_t iv_len,
    const uint32_t* subsamples, uint32_t pairs, uint8_t* data, uint32_t len) {
    uint8_t iv16[16];
    std::vector<cdm::SubsampleEntry> entries;
    cdm::InputBuffer_2 in{};
    if (!cenc_input(in, iv16, entries, key_id, key_id_len, iv, iv_len, subsamples, pairs, data, len)) return -3;
    in.timestamp = 0;
    Block out;
    cdm::Status status = h->host.cdm->Decrypt(in, &out);
    h->host.run_deferred();
    if (status != cdm::kSuccess) return static_cast<int>(status);
    cdm::Buffer* clear = out.DecryptedBuffer();
    if (!clear || clear->Size() != len) return -4;
    memcpy(data, clear->Data(), len);
    return 0;
}

extern "C" int wv_video_init(wv_host* h, uint32_t profile, int32_t width, int32_t height, const uint8_t* extra,
    uint32_t extra_len) {
    cdm::VideoDecoderConfig_2 config{};
    config.codec = cdm::kCodecH264;
    config.profile = static_cast<cdm::VideoCodecProfile>(profile);
    config.format = cdm::kI420;
    config.coded_size = {width, height};
    config.extra_data = const_cast<uint8_t*>(extra);
    config.extra_data_size = extra_len;
    config.encryption_scheme = cdm::EncryptionScheme::kCenc;
    h->host.video_deferred_done = false;
    cdm::Status status = h->host.cdm->InitVideo(config);
    if (status == cdm::kDeferredInitialization) {
        if (!h->host.pump([&] { return h->host.video_deferred_done; }, 15000)) return -1;
        status = h->host.video_deferred_status;
    }
    h->host.run_deferred();
    return static_cast<int>(status);
}

extern "C" int wv_video_decode(wv_host* h, const uint8_t* key_id, uint32_t key_id_len, const uint8_t* iv,
    uint32_t iv_len, const uint32_t* subsamples, uint32_t pairs, const uint8_t* data, uint32_t len, int64_t timestamp,
    uint8_t* out, uint32_t out_cap, int32_t* out_width, int32_t* out_height, int64_t* out_timestamp) {
    uint8_t iv16[16];
    std::vector<cdm::SubsampleEntry> entries;
    cdm::InputBuffer_2 in{};
    if (data && len) {
        if (!cenc_input(in, iv16, entries, key_id, key_id_len, iv, iv_len, subsamples, pairs, data, len)) return -3;
    } else {
        in.encryption_scheme = cdm::EncryptionScheme::kUnencrypted;  // end of stream: drain
        in.pattern = {0, 0};
    }
    in.timestamp = timestamp;
    Frame frame;
    cdm::Status status = h->host.cdm->DecodeVideo(in, &frame);
    h->host.run_deferred();
    if (status == cdm::kNeedMoreData) return 1;
    if (status != cdm::kSuccess) return static_cast<int>(status);
    cdm::Buffer* buffer = frame.FrameBuffer();
    const int32_t w = frame.Size().width, ht = frame.Size().height;
    const bool yv12 = frame.Format() == cdm::kYv12;
    if (!buffer || w <= 0 || ht <= 0 || (!yv12 && frame.Format() != cdm::kI420)) return -5;
    const uint64_t cw = (static_cast<uint64_t>(w) + 1) / 2, ch = (static_cast<uint64_t>(ht) + 1) / 2;
    const uint64_t need = static_cast<uint64_t>(w) * ht + 2 * cw * ch;
    if (out_cap < need) return -6;
    const uint8_t* base = buffer->Data();
    uint8_t* dst = out;
    // Tightly packed I420 out; YV12 stores V before U, so swap the chroma planes.
    const cdm::VideoPlane order[3] = {cdm::kYPlane, yv12 ? cdm::kVPlane : cdm::kUPlane, yv12 ? cdm::kUPlane : cdm::kVPlane};
    for (int p = 0; p < 3; p++) {
        const uint64_t pw = p ? cw : static_cast<uint64_t>(w), ph = p ? ch : static_cast<uint64_t>(ht);
        const uint32_t offset = frame.PlaneOffset(order[p]);
        const uint32_t stride = frame.Stride(order[p]);
        if (stride < pw || offset + static_cast<uint64_t>(stride) * (ph - 1) + pw > buffer->Size()) return -7;
        const uint8_t* src = base + offset;
        for (uint64_t row = 0; row < ph; row++) memcpy(dst + row * pw, src + row * stride, pw);
        dst += pw * ph;
    }
    *out_width = w;
    *out_height = ht;
    *out_timestamp = frame.Timestamp();
    return 0;
}

extern "C" void wv_video_reset(wv_host* h) {
    h->host.cdm->ResetVideo();
    h->host.run_deferred();
}

extern "C" void wv_host_close(wv_host* h) {
    if (!h) return;
    if (h->host.cdm) {
        h->host.cdm->Destroy();
        delete h->host.cdm;
        h->host.cdm = nullptr;
    }
    delete h;
}
