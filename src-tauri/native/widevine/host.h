// SPDX-License-Identifier: GPL-3.0-or-later
// Minimal C API over Google's Widevine CDM through the Chromium CDM interface (11, falling back to
// 10). The module is loaded once per process; each playback opens its own CDM instance. Every
// function on one wv_host must be called from the same thread.
#ifndef IZUMI_WIDEVINE_HOST_H
#define IZUMI_WIDEVINE_HOST_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct wv_host wv_host;

typedef struct {
    void* user;
    // type: 0 licence request, 1 renewal, 2 release, 3 individualization.
    void (*on_message)(void* user, const char* session_id, uint32_t session_id_len, uint32_t type,
        const uint8_t* message, uint32_t message_len);
    // status: 0 usable, 1 internal error, 2 expired, 3 output restricted, 4 output downscaled,
    // 5 pending, 6 released.
    void (*on_key_status)(void* user, const uint8_t* key_id, uint32_t key_id_len, uint32_t status);
    void (*on_log)(void* user, const char* line);
} wv_callbacks;

// Loads and initializes the CDM library once for this process. Loading a different path later
// fails: a newer module takes effect after a restart. Returns 0, or -1 and fills err.
int wv_module_load(const char* cdm_path, char* err, size_t err_len);
const char* wv_module_version(void);

// preferred_interface: 0 = try 11 then 10; 10 or 11 forces one. Returns NULL and fills err.
wv_host* wv_host_open(int preferred_interface, const wv_callbacks* callbacks, char* err, size_t err_len);
int wv_host_interface(const wv_host* host);
// Fires due CDM timers and deferred host replies. Call regularly while the instance is idle.
void wv_host_tick(wv_host* host);

int wv_set_server_certificate(wv_host* host, const uint8_t* certificate, uint32_t len);
// Creates a temporary session from CENC init data (pssh boxes). The licence request arrives through
// on_message before this returns. Returns 0 and writes the session id, or a negative error.
int wv_session_create(wv_host* host, const uint8_t* init_data, uint32_t init_data_len, char* session_id,
    uint32_t session_id_cap);
int wv_session_update(wv_host* host, const char* session_id, const uint8_t* response, uint32_t response_len);
int wv_session_close(wv_host* host, const char* session_id);

// Decrypts one CENC (AES-CTR) sample in place. subsamples holds (clear, cipher) pairs; pass 0 pairs
// for full-sample encryption. iv may be 8 or 16 bytes. Returns 0 on success, else a cdm::Status
// (1 need more data, 2 no key, 4 decrypt error) or a negative host error.
int wv_decrypt(wv_host* host, const uint8_t* key_id, uint32_t key_id_len, const uint8_t* iv, uint32_t iv_len,
    const uint32_t* subsamples, uint32_t subsample_pairs, uint8_t* data, uint32_t data_len);

// Video through the CDM's own decoder (decrypt-and-decode). profile is cdm::VideoCodecProfile
// (5 = H.264 High); extra is the avcC record. Input must be Annex B. Returns 0 or a cdm::Status.
int wv_video_init(wv_host* host, uint32_t profile, int32_t width, int32_t height, const uint8_t* extra,
    uint32_t extra_len);
// Decrypts and decodes one access unit (data NULL/len 0 drains the decoder). Returns 0 with an I420
// picture (tightly packed Y, U, V) written to out, 1 when the decoder needs more input, else a
// cdm::Status or negative host error. timestamp_us travels with the picture through reordering.
int wv_video_decode(wv_host* host, const uint8_t* key_id, uint32_t key_id_len, const uint8_t* iv, uint32_t iv_len,
    const uint32_t* subsamples, uint32_t subsample_pairs, const uint8_t* data, uint32_t data_len, int64_t timestamp_us,
    uint8_t* out, uint32_t out_cap, int32_t* out_width, int32_t* out_height, int64_t* out_timestamp_us);
void wv_video_reset(wv_host* host);

// Destroys the CDM instance. The module stays loaded for the next playback.
void wv_host_close(wv_host* host);

#ifdef __cplusplus
}
#endif

#endif
