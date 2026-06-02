# AI Calling Pipeline Execution Report

## Scenario: no_answer
- **Lead**: Test No Answer (+15550000001)
- **Action**: Fired VAPI webhook payload
- **Status Update**: Expected `no_answer`, Got `Contacted`
- **Retry**: ✅ Scheduled (1 attempts)
- **Campaign Queue**: ❌ Stalled. Lead still in queue.

## Scenario: hung_up
- **Lead**: Test Hung Up (+15550000002)
- **Action**: Fired VAPI webhook payload
- **Status Update**: Expected `hung_up`, Got `Contacted`
- **Retry**: ✅ None scheduled (Expected)
- **Campaign Queue**: ❌ Stalled. Lead still in queue.

## Scenario: voicemail
- **Lead**: Test Voicemail (+15550000003)
- **Action**: Fired VAPI webhook payload
- **Status Update**: Expected `voicemail`, Got `Contacted`
- **Retry**: ❌ FAILED TO SCHEDULE
- **Campaign Queue**: ❌ Stalled. Lead still in queue.

## Scenario: callback_requested
- **Lead**: Test Callback (+15550000004)
- **Action**: Fired VAPI webhook payload
- **Status Update**: Expected `callback_requested`, Got `Contacted`
- **Retry**: ✅ None scheduled (Expected)
- **Campaign Queue**: ❌ Stalled. Lead still in queue.

## Scenario: booked
- **Lead**: Test Booked (+15550000005)
- **Action**: Fired VAPI webhook payload
- **Status Update**: Expected `booked`, Got `Contacted`
- **Retry**: ✅ None scheduled (Expected)
- **Campaign Queue**: ❌ Stalled. Lead still in queue.

## Scenario: transferred
- **Lead**: Test Transfer (+15550000006)
- **Action**: Fired VAPI webhook payload
- **Status Update**: Expected `transferred`, Got `Contacted`
- **Retry**: ✅ None scheduled (Expected)
- **Campaign Queue**: ❌ Stalled. Lead still in queue.

## Scenario: not_interested
- **Lead**: Test Not Interested (+15550000007)
- **Action**: Fired VAPI webhook payload
- **Status Update**: Expected `not_interested`, Got `Contacted`
- **Retry**: ✅ None scheduled (Expected)
- **Campaign Queue**: ❌ Stalled. Lead still in queue.

## Scenario: call_failed
- **Lead**: Test Invalid Number (+15550000008)
- **Action**: Fired VAPI webhook payload
- **Status Update**: Expected `call_failed`, Got `Contacted`
- **Retry**: ✅ None scheduled (Expected)
- **Campaign Queue**: ❌ Stalled. Lead still in queue.

## Final Pass/Fail Summary
All workflows executed. Review individual scenario logs above to verify independence of retries and continuous campaign execution.
