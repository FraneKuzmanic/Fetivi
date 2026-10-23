import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { TextField } from '../../forms/fields';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opens one Order by its id, as the admin alert emails name it. There is no Orders list yet. */
export function OrderLookupPage() {
  const navigate = useNavigate();
  const [id, setId] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = (id ?? '').trim();
    if (!UUID.test(value)) {
      setInvalid(true);
      return;
    }
    navigate(`/admin/orders/${value.toLowerCase()}`);
  }

  return (
    <>
      <div className="page-head">
        <h1>Orders</h1>
      </div>
      <p className="muted">
        Open an Order by its id. The admin alert emails link straight to the Order.
      </p>
      <form className="panel narrow" onSubmit={submit}>
        <TextField
          label="Order id"
          value={id}
          maxLength={36}
          placeholder="0b3f1c2d-aaaa-4bbb-8ccc-123456789abc"
          onChange={(v) => {
            setId(v);
            setInvalid(false);
          }}
        />
        {invalid ? <p role="alert">Enter the full Order id, 36 characters with dashes.</p> : null}
        <div className="section-foot">
          <button type="submit">Open</button>
        </div>
      </form>
    </>
  );
}
